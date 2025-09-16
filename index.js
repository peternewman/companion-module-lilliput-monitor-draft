const { InstanceBase, InstanceStatus, Regex, runEntrypoint } = require('@companion-module/base')
const { combineRgb } = require('@companion-module/base')
const LilliputD = require('lilliput-monitor')
const UpgradeScripts = require('./upgrades.js')
const { PassThrough } = require('stream')

class LilliputMonitorInstance extends InstanceBase {
	processLilliputDData(data) {
		return data.dev.command.reduce(function (map, obj) {
			if (!(obj.value === undefined) && obj.value) {
				let values = obj.value
				if (!Array.isArray(values)) {
					values = [{ name: obj.name, item: values.item }]
				}
				map[obj.name] = values.reduce(function (valueArray, valueObj) {
					let valueMap = {}
					if ('name' in valueObj) {
						valueMap['name'] = valueObj.name
						if ('item' in valueObj) {
							valueMap['values'] = Array.from(valueObj.item).map((item) => item.name)
						} else {
							valueMap['values'] = []
						}
						valueArray.push(valueMap)
					}
					return valueArray
				}, [])
			} else {
				map[obj.name] = undefined
			}
			return map
		}, {})
	}

	generateChoices(data, command, value) {
		const items = data[command].find((element) => element.name == value)
		if (items && items.values) {
			var choices = []
			items.values.forEach((choice) => {
				choices.push({ id: choice, label: choice.charAt(0).toUpperCase() + choice.slice(1) })
			})
			return choices
		} else {
			return []
		}
	}

	init(config) {
		this.config = config
		this.DATA = {}

		this.CHOICES_ON_OFF = [
			{ id: 'off', label: 'Off' },
			{ id: 'on', label: 'On' },
		]

		this.CHOICES_0_100 = [
			{ id: '0', label: '0' },
			{ id: '25', label: '25' },
			{ id: '50', label: '50' },
			{ id: '75', label: '75' },
			{ id: '100', label: '100' },
		]

		this.CHOICES_VOLUME = this.CHOICES_0_100
		this.CHOICES_CONTRAST = this.CHOICES_0_100
		this.CHOICES_BRIGHTNESS = this.CHOICES_0_100
		this.CHOICES_SHARPNESS = this.CHOICES_0_100
		this.CHOICES_SATURATION = this.CHOICES_0_100
		this.CHOICES_TINT = this.CHOICES_0_100

		var tunnel = new PassThrough()
		var tmpdev = new LilliputD({ stream: tunnel }, { disconnect: true })
		//this.log('debug', 'LilliputD data ' + JSON.stringify(tmpdev.data.dev.command))
		const commands = this.processLilliputDData(tmpdev.data)
		//this.log('debug', 'Processed LilliputD data ' + JSON.stringify(commands))

		//this.log('debug', 'LilliputD input input ' + JSON.stringify(this.generateChoices(commands, 'input', 'input')))

		this.CHOICES_INPUT = this.generateChoices(commands, 'input', 'input')

		this.CHOICES_INPUT_MULTIVIEWER = this.generateChoices(commands, 'input', 'mv1-2')

		this.CHOICES_AUDIO_METER = this.generateChoices(commands, 'audio', 'meter')

		this.CHOICES_AUDIO_OUTPUT = this.generateChoices(commands, 'audio', 'right-left-out')

		this.CHOICES_UMD_TALLY = this.generateChoices(commands, 'umd', 'tally')

		this.PRESETS_SETTINGS = [
			{
				action: 'input',
				setting: 'input_name',
				feedback: 'input',
				label: '',
				choices: this.CHOICES_INPUT,
				category: 'Input',
				additionalOptions: { mv1_2: 'SDI1-SDI2', mv3_4: 'SDI3-SDI4' },
			},
			{
				action: 'audio',
				setting: 'volume',
				feedback: 'volume',
				label: 'Volume ',
				choices: this.CHOICES_VOLUME,
				category: 'Audio',
				additionalOptions: { meter: 'None', output: '2-1' },
			},
			{
				action: 'umd',
				setting: 'tally',
				feedback: 'tally',
				label: 'Tally ',
				choices: this.CHOICES_UMD_TALLY,
				category: 'UMD',
			},
			/*{
				action: 'contrast',
				setting: 'contrast',
				feedback: 'contrast',
				label: 'Contrast ',
				choices: this.CHOICES_CONTRAST,
				category: 'Picture',
			},
			{
				action: 'brightness',
				setting: 'brightness',
				feedback: 'brightness',
				label: 'Brightness ',
				choices: this.CHOICES_BRIGHTNESS,
				category: 'Picture',
			},
			{
				action: 'sharpness',
				setting: 'sharpness',
				feedback: 'sharpness',
				label: 'Sharpness ',
				choices: this.CHOICES_SHARPNESSS,
				category: 'Picture',
			},
			{
				action: 'saturation',
				setting: 'saturation',
				feedback: 'saturation',
				label: 'Saturation ',
				choices: this.CHOICES_SATURATION,
				category: 'Picture',
			},
			{
				action: 'tint',
				setting: 'tint',
				feedback: 'tint',
				label: 'Tint ',
				choices: this.CHOICES_TINT,
				category: 'Picture',
			},*/
		]

		this.actions(this) // export actions
		this.init_variables()
		this.init_feedbacks()
		this.init_presets()
		this.init_udp()
	}

	configUpdated(config) {
		this.config = config

		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket
		}

		this.init_udp()
	}

	init_udp() {
		let self = this

		if (self.dev !== undefined) {
			self.dev.process('#close')
			delete self.dev
		}

		if (!self.config.host) {
			self.updateStatus(InstanceStatus.BadConfig, `IP address is missing`)
			return
		} else if (!self.config.port) {
			self.updateStatus(InstanceStatus.BadConfig, `Port is missing`)
			return
		}

		self.updateStatus(InstanceStatus.Connecting)

		// Disconnect = false to match the previous behaviour of the module, although we don't get as much connection feedback this way
		self.dev = new LilliputD({ host: self.config.host, port: self.config.port }, { disconnect: false })
		// self.dev.emitter.on('connectionData', (data) => self.log('debug', 'Conn Data ' + JSON.stringify(data)))
		self.dev.emitter.on('connectionStatus', (data) => {
			self.log('debug', 'Conn Status ' + JSON.stringify(data))
			if (data.status !== undefined && data.status != '') {
				switch (data.status) {
					case 'connected':
						self.updateStatus(InstanceStatus.Ok)
						break
					case 'closed':
						self.updateStatus(InstanceStatus.Disconnected)
						// Try to reconnect
						// TODO(Peter): Do some sort of backoff?
						if (self.dev !== undefined) {
							self.dev.process('#connect')
						}
						break
					case 'error':
						// TODO(Peter): Extract more status
						// e.g. "more":{"errno":-104,"code":"ECONNRESET","syscall":"read"}
						self.updateStatus(InstanceStatus.UnknownError)
						break
					default:
						self.updateStatus(InstanceStatus.ConnectionFailure, 'Failed to connect - ' + data.status)
						break
				}
			} else {
				self.updateStatus(InstanceStatus.UnknownError, 'Unknown failure connecting')
			}
		})
		self.dev.emitter.on('commandForDevice', (data) => self.log('debug', 'Tx: ' + JSON.stringify(data)))
		self.dev.emitter.on('responseFromDevice', (data) => {
			self.log('debug', 'Rx: ' + JSON.stringify(data))
			if (data.status !== undefined && data.status != '') {
				switch (data.status) {
					case 'OK':
						// TODO(Peter): Deduplicate this
						self.updateStatus(InstanceStatus.Ok)
						// Handle updated data
						if (typeof data.value === 'object' || Array.isArray(data.value)) {
							for (var k in data.value) {
								self.DATA[k] = data.value[k]
							}
						} else {
							self.DATA[data.req] = data.value
						}
						self.log('debug', 'Overall data: ' + JSON.stringify(self.DATA))
						// TODO(Peter): Could potentially be slightly more efficient here
						this.setVariableValues(self.DATA)
						// TODO(Peter): Could potentially be slightly more efficient here
						/*this.checkFeedbacks('input')
						this.checkFeedbacks('mute')
						this.checkFeedbacks('volume')
						this.checkFeedbacks('power')
						this.checkFeedbacks('contrast')
						this.checkFeedbacks('brightness')
						this.checkFeedbacks('sharpness')
						this.checkFeedbacks('saturation')
						this.checkFeedbacks('tint')*/

						break
					default:
						self.updateStatus(InstanceStatus.UnknownWarning, 'Request ' + data.req + ' failed')
				}
			} else {
				self.updateStatus(InstanceStatus.UnknownWarning, 'Unknown comms error')
			}
		})

		// Force a connect for now
		self.dev.process('#connect')

		// We use lots of the statuses and expose the others as variables
		// It's also generally useful to trigger a connectionStatus message
		//self.dev.process('status?')
	}

	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 6,
				regex: Regex.IP,
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'Target Port',
				width: 6,
				default: '19523',
				regex: Regex.PORT,
			},
		]
	}

	// When module gets deleted
	destroy() {
		if (this.dev !== undefined) {
			this.dev.process('#close')
			delete this.dev
		}

		this.log('debug', 'destroy ' + this.id)
	}

	init_variables() {
		var variableDefinitions = []

		/*variableDefinitions.push({
			name: 'Volume',
			variableId: 'volume',
		})

		variableDefinitions.push({
			name: 'Mute',
			variableId: 'mute',
		})

		variableDefinitions.push({
			name: 'Input',
			variableId: 'input',
		})

		variableDefinitions.push({
			name: 'Contrast',
			variableId: 'contrast',
		})

		variableDefinitions.push({
			name: 'Brightness',
			variableId: 'brightness',
		})

		variableDefinitions.push({
			name: 'Sharpness',
			variableId: 'sharpness',
		})

		variableDefinitions.push({
			name: 'Saturation',
			variableId: 'saturation',
		})

		variableDefinitions.push({
			name: 'Tint',
			variableId: 'tint',
		})*/

		// TODO(Peter): Add and expose other variables

		this.setVariableDefinitions(variableDefinitions)
	}

	init_feedbacks() {
		// feedbacks
		var feedbacks = []

		/*feedbacks['input'] = {
			type: 'boolean',
			name: 'Input',
			description: 'If the input specified is the current input, give feedback',
			options: [
				{
					type: 'dropdown',
					label: 'Input',
					id: 'input_name',
					choices: this.CHOICES_INPUT,
				},
			],
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			callback: (feedback, bank) => {
				return this.DATA.input == feedback.options.input_name
			},
		}

		feedbacks['volume'] = {
			type: 'boolean',
			name: 'Volume',
			description: 'If the system volume is at the selected volume, give feedback',
			options: [
				{
					type: 'number',
					label: 'Volume',
					id: 'volume',
					default: 50,
					min: 0,
					max: 100,
					required: true,
					step: 1,
				},
			],
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			callback: (feedback, bank) => {
				return this.DATA.volume == parseInt(feedback.options.volume)
			},
		}

		feedbacks['contrast'] = {
			type: 'boolean',
			name: 'Contrast',
			description: 'If the system contrast is at the selected level, give feedback',
			options: [
				{
					type: 'number',
					label: 'Contrast',
					id: 'contrast',
					default: 50,
					min: 0,
					max: 100,
					required: true,
					step: 1,
				},
			],
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			callback: (feedback, bank) => {
				return this.DATA.contrast == parseInt(feedback.options.contrast)
			},
		}

		feedbacks['brightness'] = {
			type: 'boolean',
			name: 'Brightness',
			description: 'If the system brightness is at the selected level, give feedback',
			options: [
				{
					type: 'number',
					label: 'Brightness',
					id: 'brightness',
					default: 50,
					min: 0,
					max: 100,
					required: true,
					step: 1,
				},
			],
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			callback: (feedback, bank) => {
				return this.DATA.brightness == parseInt(feedback.options.brightness)
			},
		}

		feedbacks['sharpness'] = {
			type: 'boolean',
			name: 'Sharpness',
			description: 'If the system sharpness is at the selected level, give feedback',
			options: [
				{
					type: 'number',
					label: '',
					id: '',
					default: 50,
					min: 0,
					max: 100,
					required: true,
					step: 1,
				},
			],
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			callback: (feedback, bank) => {
				return this.DATA.sharpness == parseInt(feedback.options.sharpness)
			},
		}

		feedbacks['saturation'] = {
			type: 'boolean',
			name: 'Saturation',
			description: 'If the system saturation is at the selected level, give feedback',
			options: [
				{
					type: 'number',
					label: 'Saturation',
					id: 'saturation',
					default: 50,
					min: 0,
					max: 100,
					required: true,
					step: 1,
				},
			],
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			callback: (feedback, bank) => {
				return this.DATA.saturation == parseInt(feedback.options.saturation)
			},
		}

		feedbacks['tint'] = {
			type: 'boolean',
			name: 'Tint',
			description: 'If the system tint is at the selected level, give feedback',
			options: [
				{
					type: 'number',
					label: 'Tint',
					id: 'tint',
					default: 50,
					min: 0,
					max: 100,
					required: true,
					step: 1,
				},
			],
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			callback: (feedback, bank) => {
				return this.DATA.tint == parseInt(feedback.options.tint)
			},
		}*/

		this.setFeedbackDefinitions(feedbacks)
	}

	init_presets() {
		let presets = []

		for (var type in this.PRESETS_SETTINGS) {
			for (var choice in this.PRESETS_SETTINGS[type].choices) {
				var optionData = {}
				if (this.PRESETS_SETTINGS[type].additionalOptions !== undefined) {
					for (var opt in this.PRESETS_SETTINGS[type].additionalOptions) {
						optionData[opt] = this.PRESETS_SETTINGS[type].additionalOptions[opt]
					}
				}
				optionData[this.PRESETS_SETTINGS[type].setting] = this.PRESETS_SETTINGS[type].choices[choice].id

				presets[`${this.PRESETS_SETTINGS[type].action}_${this.PRESETS_SETTINGS[type].choices[choice].id}`] = {
					category: this.PRESETS_SETTINGS[type].category,
					name: this.PRESETS_SETTINGS[type].label + this.PRESETS_SETTINGS[type].choices[choice].label,
					type: 'button',
					style: {
						text: this.PRESETS_SETTINGS[type].label + this.PRESETS_SETTINGS[type].choices[choice].label,
						size: '14',
						color: combineRgb(255, 255, 255),
						bgcolor: combineRgb(0, 0, 0),
					},
					/*feedbacks: [
						{
							feedbackId: this.PRESETS_SETTINGS[type].feedback,
							style: {
								bgcolor: combineRgb(255, 255, 0),
								color: combineRgb(0, 0, 0),
							},
							options: optionData,
						},
					],*/
					steps: [
						{
							down: [
								{
									actionId: this.PRESETS_SETTINGS[type].action,
									options: optionData,
								},
							],
							up: [],
						},
					],
				}
			}
		}

		this.setPresetDefinitions(presets)
	}

	actions(system) {
		system.setActionDefinitions({
			input: {
				name: 'Input',
				options: [
					{
						type: 'dropdown',
						label: 'Input',
						id: 'input_name',
						choices: system.CHOICES_INPUT,
						default: system.CHOICES_INPUT.length > 0 ? system.CHOICES_INPUT[0].id : '',
					},
					{
						type: 'dropdown',
						label: 'MV1-2',
						id: 'mv1_2',
						choices: system.CHOICES_INPUT_MULTIVIEWER,
						default: system.CHOICES_INPUT_MULTIVIEWER.length > 0 ? system.CHOICES_INPUT_MULTIVIEWER[0].id : '',
					},
					{
						type: 'dropdown',
						label: 'MV3-4',
						id: 'mv3_4',
						choices: system.CHOICES_INPUT_MULTIVIEWER,
						default: system.CHOICES_INPUT_MULTIVIEWER.length > 0 ? system.CHOICES_INPUT_MULTIVIEWER[0].id : '',
					},
				],
				callback: async (action) => {
					await system.doAction(
						'input ' + action.options.input_name + ',' + action.options.mv1_2 + ',' + action.options.mv3_4,
					)
				},
			},
			audio: {
				name: 'Audio',
				options: [
					{
						type: 'number',
						label: 'Volume',
						id: 'volume',
						default: 50,
						min: 0,
						max: 100,
						required: true,
						step: 1,
					},
					{
						type: 'dropdown',
						label: 'Meter',
						id: 'meter',
						choices: system.CHOICES_AUDIO_METER,
						default: system.CHOICES_AUDIO_METER.length > 0 ? system.CHOICES_AUDIO_METER[0].id : '',
					},
					{
						type: 'dropdown',
						label: 'Output (Right, Left)',
						id: 'output',
						choices: system.CHOICES_AUDIO_OUTPUT,
						default: system.CHOICES_AUDIO_OUTPUT.length > 0 ? system.CHOICES_AUDIO_OUTPUT[0].id : '',
					},
				],
				callback: async (action) => {
					await system.doAction(
						'audio ' + action.options.volume + ',' + action.options.meter + ',' + action.options.output,
					)
				},
			},
			umd: {
				name: 'UMD',
				options: [
					{
						type: 'dropdown',
						label: 'Tally Color',
						id: 'tally',
						choices: system.CHOICES_UMD_TALLY,
						default: system.CHOICES_UMD_TALLY.length > 0 ? system.CHOICES_UMD_TALLY[0].id : '',
					},
					{
						type: 'textinput',
						label: 'Text',
						id: 'text',
					},
					/*{
						type: 'dropdown',
						label: 'Meter',
						id: 'meter',
						choices: system.CHOICES_AUDIO_METER,
						default: system.CHOICES_AUDIO_METER.length > 0 ? system.CHOICES_AUDIO_METER[0].id : '',
					},
					{
						type: 'dropdown',
						label: 'Output (Right, Left)',
						id: 'output',
						choices: system.CHOICES_AUDIO_OUTPUT,
						default: system.CHOICES_AUDIO_OUTPUT.length > 0 ? system.CHOICES_AUDIO_OUTPUT[0].id : '',
					},*/
				],
				callback: async (action) => {
					var text = action.options.text
					var encodedText = ''
					for (var i = 0; i < 16; i++) {
						if (i < text.length) {
							encodedText += ',0x' + text.charCodeAt(i).toString(16)
						} else {
							encodedText += ',0x20'
						}
					}
					await system.doAction('umd ' + action.options.tally + encodedText + ',val1a,val2a')
				},
			},
			/*contrast: {
				name: 'Contrast',
				options: [
					{
						type: 'number',
						label: 'Contrast',
						id: 'contrast',
						default: 50,
						min: 0,
						max: 100,
						required: true,
						step: 1,
					},
				],
				callback: async (action) => {
					await system.doAction('contrast ' + action.options.contrast)
				},
			},
			brightness: {
				name: 'Brightness',
				options: [
					{
						type: 'number',
						label: 'Brightness',
						id: 'brightness',
						default: 50,
						min: 0,
						max: 100,
						required: true,
						step: 1,
					},
				],
				callback: async (action) => {
					await system.doAction('brightness ' + action.options.brightness)
				},
			},
			sharpness: {
				name: 'Sharpness',
				options: [
					{
						type: 'number',
						label: 'Sharpness',
						id: 'sharpness',
						default: 50,
						min: 0,
						max: 100,
						required: true,
						step: 1,
					},
				],
				callback: async (action) => {
					await system.doAction('sharpness ' + action.options.sharpness)
				},
			},
			saturation: {
				name: 'Saturation',
				options: [
					{
						type: 'number',
						label: 'Saturation',
						id: 'saturation',
						default: 50,
						min: 0,
						max: 100,
						required: true,
						step: 1,
					},
				],
				callback: async (action) => {
					await system.doAction('saturation ' + action.options.saturation)
				},
			},
			tint: {
				name: 'Tint',
				options: [
					{
						type: 'number',
						label: 'Tint',
						id: 'tint',
						default: 50,
						min: 0,
						max: 100,
						required: true,
						step: 1,
					},
				],
				callback: async (action) => {
					await system.doAction('tint ' + action.options.tint)
				},
			},*/
			customCommand: {
				name: 'Custom Command',
				options: [
					{
						type: 'textinput',
						label: 'Command',
						id: 'command',
						default: 'volume $(internal:time_s)',
						useVariables: true,
					},
				],
				callback: async (action, context) => {
					const command = await context.parseVariablesInString(action.options.command)
					await system.doAction(command)
				},
			},
		})
	}

	doAction(cmd) {
		let self = this
		if (cmd !== undefined && cmd != '') {
			self.log('debug', 'sending "' + cmd + '" to ' + this.config.host)

			// This is using parts of the library that aren't publicly exposed and may change
			if (
				this.dev !== undefined &&
				this.dev.mode == 'udp' &&
				this.dev.socket !== undefined
				// && this.dev.socket.readyState === 'open'
			) {
				this.dev.process(cmd)
			} else {
				// TODO(Peter): Should probably allow the internal # commands through regardless here
				this.log('debug', 'Socket not connected :(')
			}
		}
	}
}
runEntrypoint(LilliputMonitorInstance, UpgradeScripts)
