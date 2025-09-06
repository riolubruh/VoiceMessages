/**
 * @name VoiceMessages
 * @author Riolubruh
 * @authorLink https://github.com/riolubruh
 * @description Allows you to send voice messages like on mobile. To do so, click the upload button and click Send Voice Message.
 * @version 0.1.6
 * @invite EFmGEWAUns
 * @source https://github.com/riolubruh/VoiceMessages
 */
/*@cc_on
@if(@_jscript)
	
	// Offer to self-install for clueless users that try to run this directly.
	var shell = WScript.CreateObject("WScript.Shell");
	var fs = new ActiveXObject("Scripting.FileSystemObject");
	var pathPlugins = shell.ExpandEnvironmentStrings("%APPDATA%\\BetterDiscord\\plugins");
	var pathSelf = WScript.ScriptFullName;
	// Put the user at ease by addressing them in the first person
	shell.Popup("It looks like you've mistakenly tried to run me directly. \n(Don't do that!)", 0, "I'm a plugin for BetterDiscord", 0x30);
	if(fs.GetParentFolderName(pathSelf) === fs.GetAbsolutePathName(pathPlugins)) {
		shell.Popup("I'm in the correct folder already.", 0, "I'm already installed", 0x40);
	} else if(!fs.FolderExists(pathPlugins)) {
		shell.Popup("I can't find the BetterDiscord plugins folder.\nAre you sure it's even installed?", 0, "Can't install myself", 0x10);
	} else if(shell.Popup("Should I copy myself to BetterDiscord's plugins folder for you?", 0, "Do you need some help?", 0x34) === 6) {
		fs.CopyFile(pathSelf, fs.BuildPath(pathPlugins, fs.GetFileName(pathSelf)), true);
		// Show the user where to put plugins in the future
		shell.Exec("explorer " + pathPlugins);
		shell.Popup("I'm installed!", 0, "Successfully installed", 0x40);
	}
	WScript.Quit();

@else@*/

/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// #region Constants
const config = {
	"info": {
		"name": "VoiceMessages",
		"authors": [{
			"name": "Riolubruh",
			"discord_id": "359063827091816448",
			"github_username": "riolubruh"
		}],
		"version": "0.1.6",
		"description": "Allows you to send voice messages like on mobile. To do so, click the upload button and click Send Voice Message.",
		"github": "https://github.com/riolubruh/VoiceMessages",
		"github_raw": "https://raw.githubusercontent.com/riolubruh/VoiceMessages/main/VoiceMessages.plugin.js"
	},
	changelog: [
		{
			title: "0.1.6",
			items: [
				"Fixed plugin not working on BetterDiscord Canary." //thx arven and doggybootsy
			]
		}
	],
	settingsPanel: [
		{ type: "switch", id: "skipMetadata", name: "Skip Metadata Calculation", note: "Skips processing the metadata of the audio file. Prevents a crash when attempting to upload really long audio files, but causes a flat waveform.", value: () => settings.skipMetadata },
		{ type: "switch", id: "screenSharing", name: "Voice Download", note: "Enables my port of Vencord's voiceDownload plugin to BetterDiscord, adding a download button to voice messages.", value: () => settings.voiceDownload }
	],
	"main": "VoiceMessages.plugin.js"
};
const defaultSettings = {
	"skipMetadata": false,
	"voiceDownload": true
}
const EMPTY_META = {
	waveform: "AAAAAAAAAAAA",
	duration: 1,
};
// #endregion

let settings = {};

// #region Modules
const { React, Webpack, UI, Patcher, Data, ContextMenu, Logger, DOM, Plugins, Components } = BdApi;
const { createElement, useState, useEffect, useMemo } = React;
const ReactUtils = Webpack.getMangled(/ConfirmModal:\(\)=>.{1,3}.ConfirmModal/, {
    FormTitle: Webpack.Filters.byStrings('["defaultMargin".concat', 'faded'),
    openModal: Webpack.Filters.byStrings('onCloseRequest:null!='),
    ModalRoot: Webpack.Filters.byStrings("fullscreenOnMobile", "scale(1)"),
    ModalHeader: Webpack.Filters.byStrings("Wrap.NO_WRAP,className:", ";let{headerId:"),
    ModalFooter: Webpack.Filters.byStrings("footer", "footerSeparator"),
    ModalContent: Webpack.Filters.byStrings(",scrollbarType:"),
    Anchor: Webpack.Filters.byStrings("useDefaultUnderlineStyles", "getDefaultLinkInterceptor")
});
const [
	VoiceInfo,
	CloudUploader,
	VoiceMessage,
	MessageActions,
	Dispatcher,
	HTTP,
	SelectedChannelStore,
	PendingReplyStore,
	PermissionStore,
	PopoutMenuModule,
	SnowflakeUtils
] = Webpack.getBulk(
    {filter: Webpack.Filters.byKeys('getEchoCancellation')},
	{filter: Webpack.Filters.byPrototypeKeys("uploadFileToCloud"), searchExports:true},
	{filter: m => m.type?.toString?.().includes("waveform:"), searchExports:true},
	{filter: Webpack.Filters.byKeys('getSendMessageOptionsForReply')},
	{filter: Webpack.Filters.byKeys("dispatch", "subscribe")},
	{filter: m => typeof m === "object" && "delete" in m && "patch" in m, searchExports:false},
	{filter: Webpack.Filters.byStoreName('SelectedChannelStore')},
	{filter: Webpack.Filters.byStoreName('PendingReplyStore')},
	{filter: Webpack.Filters.byStoreName('PermissionStore')},
	{filter: Webpack.Filters.byStrings("Send Attachment"), defaultExport:false},
	{filter: Webpack.Filters.byKeys('fromTimestamp'), searchExports:true}
)
const discordVoice = DiscordNative.nativeModules.requireModule("discord_voice");
const fs = require("fs");
const path = require("path");
// #endregion

// #region Global Functions
function useObjectUrl() {
	const [url, setUrl] = useState("");
	const setWithFree = (blob) => {
		if (url)
			URL.revokeObjectURL(url);
		setUrl(URL.createObjectURL(blob));
	};

	return [url, setWithFree];
}

function useAwaiter(factory, providedOpts) {
	const opts = Object.assign({
		fallbackValue: null,
		deps: [],
		onError: null,
	}, providedOpts);
	const [state, setState] = useState({
		value: opts.fallbackValue,
		error: null,
		pending: true
	});

	useEffect(() => {
		let isAlive = true;
		if (!state.pending) setState({ ...state, pending: true });

		factory()
			.then(value => {
				if (!isAlive) return;
				setState({ value, error: null, pending: false });
				opts.onSuccess?.(value);
			})
			.catch(error => {
				if (!isAlive) return;
				setState({ value: null, error, pending: false });
				opts.onError?.(error);
			});

		return () => void (isAlive = false);
	}, opts.deps);

	return [state.value, state.error, state.pending];
}

function useTimer({ interval = 1000, deps = [] }) { //A timer to count how long the voice message is when you are recording.
	const [time, setTime] = useState(0);
	const start = useMemo(() => Date.now(), deps);

	useEffect(() => {
		const intervalId = setInterval(() => setTime(Date.now() - start), interval);

		return () => {
			setTime(0);
			clearInterval(intervalId);
		};
	}, deps);

	return time;
}

function chooseFile(mimeTypes) { //Makes the choose file dialog appear and returns the resulting file
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file";
		input.style.display = "none";
		input.accept = mimeTypes;
		input.onchange = async () => {
			resolve(input.files?.[0] ?? null);
		};

		document.body.appendChild(input);
		input.click();
		setImmediate(() => document.body.removeChild(input));
	});
}

async function sendAudio(blob, meta) { //Sends the voice message
	if (!blob) return;
	if (!meta) meta = EMPTY_META;

	if (blob.size == 0) {
		UI.showToast("Voice message data was empty. Aborted upload.", { type: "error" });
		return;
	}

	const channelId = SelectedChannelStore.getCurrentlySelectedChannelId();
	const reply = PendingReplyStore.getPendingReply(channelId);
	if (reply) Dispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

	const upload = await new CloudUploader({
		file: new File([blob], "voice-message.ogg", { type: "audio/ogg; codecs=opus" }),
		isThumbnail: false,
		platform: 1,
	}, channelId, false, 0);

	upload.on("complete", () => {
		HTTP.post({
			url: `/channels/${channelId}/messages`,
			body: {
				flags: 1 << 13,
				channel_id: channelId,
				content: "",
				nonce: SnowflakeUtils.fromTimestamp(Date.now()),
				sticker_ids: [],
				type: 0,
				attachments: [{
					id: "0",
					filename: upload.filename,
					uploaded_filename: upload.uploadedFilename,
					waveform: meta.waveform,
					duration_secs: meta.duration
				}],
				message_reference: reply ? MessageActions.getSendMessageOptionsForReply(reply)?.messageReference : null,
			}
		});
	});
	upload.on("error", () => UI.showToast("Failed to upload voice message", { type: "error" }));
	
	upload.upload();
}
// #endregion

// #region React Elements
function VoiceMessageModal({ modalProps, shouldSkipMetadata }) {
	const [isRecording, setRecording] = useState(false);
	const [blob, setBlob] = useState();
	const [blobUrl, setBlobUrl] = useObjectUrl();

	useEffect(() => () => {
		if (blobUrl)
			URL.revokeObjectURL(blobUrl);
	}, [blobUrl]);

	const [meta] = useAwaiter(async () => {
		if (!blob) return EMPTY_META;
		if (shouldSkipMetadata) {
			return EMPTY_META;
		}
		const audioContext = new AudioContext();
		const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
		const channelData = audioBuffer.getChannelData(0);

		const clamp = (num, min, max) => Math.min(Math.max(num, min), max)
		// average the samples into much lower resolution bins, maximum of 256 total bins
		const bins = new Uint8Array(clamp(Math.floor(audioBuffer.duration * 10), Math.min(32, channelData.length), 256));
		const samplesPerBin = Math.floor(channelData.length / bins.length);

		// Get root mean square of each bin
		for (let binIdx = 0; binIdx < bins.length; binIdx++) {
			let squares = 0;
			for (let sampleOffset = 0; sampleOffset < samplesPerBin; sampleOffset++) {
				const sampleIdx = binIdx * samplesPerBin + sampleOffset;
				squares += channelData[sampleIdx] ** 2;
			}
			bins[binIdx] = ~~(Math.sqrt(squares / samplesPerBin) * 0xFF);
		}

		// Normalize bins with easing
		const maxBin = Math.max(...bins);
		const ratio = 1 + (0xFF / maxBin - 1) * Math.min(1, 100 * (maxBin / 0xFF) ** 3);
		for (let i = 0; i < bins.length; i++) bins[i] = Math.min(0xFF, ~~(bins[i] * ratio));

		return {
			waveform: window.btoa(String.fromCharCode(...bins)),
			duration: audioBuffer.duration,
		};
	}, {
		deps: [blob],
		fallbackValue: EMPTY_META,
	});

	const isUnsupportedFormat = blob && (
		!blob.type.startsWith("audio/ogg")
		|| blob.type.includes("codecs") && !blob.type.includes("opus")
	);

	return createElement(ReactUtils.ModalRoot, {
		transitionState: 1,
		children: [
			createElement(ReactUtils.ModalHeader, {
				children: [
					createElement(ReactUtils.FormTitle, {
						children: "Record Voice Message"
					})
				]
			}),
			createElement(ReactUtils.ModalContent, {
				className: "bd-vmsg-modal",
				children: [
					createElement("div", {
						className: "bd-vmsg-buttons",
						children: [
							createElement(VoiceRecorder, {
								setAudioBlob: (blob) => {
									setBlob(blob);
									setBlobUrl(blob);
								},
								onRecordingChange: setRecording
							}),
							createElement(Components.Button, {
								onClick: async () => {
									const file = await chooseFile("audio/*");
									if (file) {
										setBlob(file);
										setBlobUrl(file);
									}
								},
								children: "Upload File",
								style: {
									marginTop: "10px"
								}
							})
						]
					}),
					createElement(ReactUtils.FormTitle, { children: "Preview" }),
					createElement(VoicePreview, {
						src: blobUrl,
						waveform: meta?.waveform,
						recording: isRecording
					}),
					(() => {
						if (isUnsupportedFormat) {
							return createElement("div", {
								className: `bd-plugins-restart-card`,
								style: {
									border: "1px solid black",
									padding: "1px 4px",
									marginTop: "20px"
								},
								children: [
									createElement(Components.Text, {
										children: `Voice Messages have to be OggOpus to be playable on iOS. This file is ${blob.type} so it will not be playable on iOS.`
									}),
									createElement(Components.Text, {
										style: {
											marginTop: "8px"
										},
										children: [
											`To fix it, first convert it to OggOpus, for example using the `,
											createElement(ReactUtils.Anchor, {
												href: "https://convertio.co/mp3-opus/",
												children: "convertio web converter"
											})
										]
									})
								]
							})
						}
					})()
				]
			}),
			createElement(ReactUtils.ModalFooter, {
				children: [
					createElement(Components.Button, {
						disabled: !blob,
						onClick: async () => {
							modalProps.onClose();
							sendAudio(blob, meta);
							UI.showToast("Now sending voice message... Please be patient", { type: "info" });
						},
						children: "Send"
					})
				]
			})
		]
	})
}

function VoiceRecorder({ setAudioBlob, onRecordingChange }) {
	const [recording, setRecording] = useState(false);

	const changeRecording = (recording) => {
		setRecording(recording);
		onRecordingChange?.(recording);
	};

	function readRecording(filePath) {
		try {
			filePath = path.normalize(filePath);
			const buf = fs.readFileSync(filePath, "", function (err) {
				Logger.error(config.info.name, err);
			});
			return new Uint8Array(buf);
		} catch (err) {
			Logger.error(config.info.name, err);
			return null;
		}
	}

	function toggleRecording() {
		const nowRecording = !recording;

		if (nowRecording) {
			discordVoice.startLocalAudioRecording(
				{
					echoCancellation: VoiceInfo.getEchoCancellation(),
					noiseCancellation: VoiceInfo.getNoiseSuppression,
				},
				(success) => {
					if (success) {
						changeRecording(true);

					} else
						UI.showToast("Failed to start recording", { type: "error" });
				}
			);
		} else {
			discordVoice.stopLocalAudioRecording(async filePath => {
				if (filePath) {
					const buf = readRecording(filePath);
					if (buf) {
						setAudioBlob(new Blob([buf], { type: "audio/ogg; codecs=opus" }));
					}
					else
						UI.showToast("Failed to finish recording", { type: "error" });
				}
				changeRecording(false);
			});
		}
	}

	return createElement(Components.Button, {
		id: "toggleRecordingButton",
		onClick: () => {
			toggleRecording();
		},
		children: `${recording ? "Stop" : "Start"} recording`,
		style: {
			marginTop: "10px"
		}
	}
	);
};

function VoicePreview({ src, waveform, recording }) {
	if (!waveform) waveform = EMPTY_META.waveform;
	const durationMs = useTimer({
		deps: [recording]
	});

	const durationSeconds = recording ? Math.floor(durationMs / 1000) : 0;
	const durationDisplay = "" + (Math.floor(durationSeconds / 60) + ":" + (durationSeconds % 60).toString().padStart(2, "0"));

	if (src && !recording) {
		return createElement("div", {
			children: createElement(VoiceMessage, {
				key: src,
				"src": src,
				"waveform": waveform,
				durationSecs: durationSeconds
			})
		});
	}

	return createElement("div", {
		className: (() => { return ("bd-vmsg-preview" + (recording ? " bd-vmsg-preview-recording" : "")) })(),
		children: [
			createElement("div", {
				className: "bd-vmsg-preview-indicator",
			}),
			createElement("div", {
				className: "bd-vmsg-preview-time",
				children: durationDisplay
			}),
			createElement("div", {
				className: "bd-vmsg-preview-label",
				children: (() => { return (recording ? "RECORDING" : "----") })()
			})
		]
	});
}

function Icon({ height = 24, width = 24, className, children, viewBox, ...svgProps }) {
	return createElement("svg", {
		className: `${className} bd-icon`,
		role: "img",
		width,
		height,
		viewBox,
		...svgProps,
		children
	})
}

function Microphone(props) {
	return createElement(Icon, {
		...props,
		className: `${props.className} bd-microphone`,
		viewBox: "0 0 24 24",
		children: [
			createElement("path", {
				fillRule: "evenodd",
				clipRule: "evenodd",
				d: "M14.99 11C14.99 12.66 13.66 14 12 14C10.34 14 9 12.66 9 11V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5L14.99 11ZM12 16.1C14.76 16.1 17.3 14 17.3 11H19C19 14.42 16.28 17.24 13 17.72V21H11V17.72C7.72 17.23 5 14.41 5 11H6.7C6.7 14 9.24 16.1 12 16.1ZM12 4C11.2 4 11 4.66667 11 5V11C11 11.3333 11.2 12 12 12C12.8 12 13 11.3333 13 11V5C13 4.66667 12.8 4 12 4Z",
				fill: "currentColor"
			}),
			createElement("path", {
				fillRule: "evenodd",
				clipRule: "evenodd",
				d: "M14.99 11C14.99 12.66 13.66 14 12 14C10.34 14 9 12.66 9 11V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5L14.99 11ZM12 16.1C14.76 16.1 17.3 14 17.3 11H19C19 14.42 16.28 17.24 13 17.72V22H11V17.72C7.72 17.23 5 14.41 5 11H6.7C6.7 14 9.24 16.1 12 16.1Z",
				fill: "currentColor"
			})
		]
	})
}
// #endregion 

// #region Exports
module.exports = class VoiceMessages {
	constructor(meta) {
		this.meta = meta;
	}
	getSettingsPanel() {
		return UI.buildSettingsPanel({
			settings: config.settingsPanel,
			onChange: (category, id, value) => {
				settings[id] = value;
				this.saveAndUpdate();
			}
		})
	}

	saveAndUpdate() { //Saves and updates settings and runs functions
		Data.save(this.meta.name, "settings", settings);
		Patcher.unpatchAll(this.meta.name);	
		this.patchPopoutMenu();
		if (settings.voiceDownload) this.patchVoiceMessage();
	}

	patchPopoutMenu() { //Adds the "Send voice message" button to the popout menu

		let name = Object.keys(PopoutMenuModule)[0];

		Patcher.after(this.meta.name, PopoutMenuModule, name, (_, [args], ret) => {

			//											  SEND_VOICE_MESSAGES								 SEND_MESSAGES
			if (args.channel.guild_id && !(PermissionStore.can(1n << 46n, args.channel) && PermissionStore.can(1n << 11n, args.channel)))
				return;

			ret.props.children.push(ContextMenu.buildItem({
				id: "bd-send-vmsg",
				label: createElement("div", {
					style: {
						display: "flex",
						alignItems: "center",
						verticalAlign: "middle"
					},
					children: [
						//microphone icon
						createElement(Microphone, {
							height: 24,
							width: 24
						}),
						//option name
						createElement("div", {
							children: "Send Voice Message",
							style: {
								marginLeft: "8px",
								fontSize: "14px",
							}
						})
					]
				}),
				action: () => {
					ReactUtils.openModal(modalProps => createElement(VoiceMessageModal, { modalProps, shouldSkipMetadata: settings.skipMetadata }), {
						onCloseCallback: () => {
							//ensure we stop recording if the user suddenly closes the modal without pressing stop
							discordVoice.stopLocalAudioRecording(filePath => { return; })
						}
					});
				}
			}))
		});
	}

	patchVoiceMessage() { // Adds voiceDownload button to VoiceMessage elements
		Patcher.after(this.meta.name, VoiceMessage, "type", (_, [args], ret) => {
			ret.props.children.push(React.createElement("a", {
				className: "bd-voice-download",
				href: args?.item?.downloadUrl != undefined ? args.item.downloadUrl : "#",
				onClick: function (e) { e => e.stopPropagation() },
				ariaLabel: "Download voice message",
				target: "_blank",
				download: "voice-message.ogg",
				children: React.createElement("svg", {
					height: "24",
					width: "24",
					viewBox: "0 0 24 24",
					fill: "currentColor",
					children: React.createElement("path", {
						d: "M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1ZM3 20a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Z"
					})
				})
			}));
		});
	}


	start() {
		Patcher.unpatchAll(this.meta.name)
		DOM.addStyle(this.meta.name, `
			.bd-vmsg-modal {
				padding: 1em;
			}
						
			.bd-vmsg-buttons {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 0.5em;
				margin-bottom: 1em;
			}
						
			.bd-vmsg-modal audio {
				width: 100%;
			}
						
			.bd-vmsg-preview {
				color: var(--text-default);
				border-radius: 24px;
				background-color: var(--background-base-lower);
				position: relative;
				display: flex;
				align-items: center;
				padding: 0 16px;
				height: 48px;
			}
			
			.bd-vmsg-preview-indicator {
				background: var(--button-secondary-background);
				width: 16px;
				height: 16px;
				border-radius: 50%;
				transition: background 0.2s ease-in-out;
			}
			
			.bd-vmsg-preview-recording .bd-vmsg-preview-indicator {
				background: var(--status-danger);
			}
			
			.bd-vmsg-preview-time {
				opacity: 0.8;
				margin: 0 0.5em;
				font-size: 80%;
			
				/* monospace so different digits have same size */
				font-family: var(--font-code);
			}
			
			.bd-vmsg-preview-label {
				opacity: 0.5;
				letter-spacing: 0.125em;
				font-weight: 600;
				flex: 1;
				text-align: center;
			}

			.bd-voice-download {
				width: 24px;
				height: 24px;
				color: var(--interactive-normal);
				margin-left: 12px;
				cursor: pointer;
				position: relative;
			}

			.bd-voice-download:hover {
				color: var(--interactive-active);
			}
		`);
		try{
            //load settings from config
            settings = Object.assign({}, defaultSettings, Data.load(this.meta.name, "settings"));
        }catch(err){
            //The super mega awesome data-unfucker 9000
            Logger.warn(this.meta.name, err);
            Logger.info(this.meta.name, "Error parsing JSON. Resetting file to default...");
            //watch this shit yo
            require("fs").rmSync(require("path").join(Plugins.folder, `${this.meta.name}.config.json`));
            Plugins.reload(this.meta.name);
            Plugins.enable(this.meta.name);
            return;
        }

		//changelog
		try{
            let currentVersionInfo = {version: this.meta.version, hasShownChangelog: false};
            try{
                currentVersionInfo = Object.assign({}, {version: this.meta.version, hasShownChangelog: false}, Data.load(this.meta.name, "currentVersionInfo"));
            }catch(err){
                currentVersionInfo = {hasShownChangelog: false};
            }
			if(currentVersionInfo.version != this.meta.version){
				currentVersionInfo.hasShownChangelog = false;
				currentVersionInfo.version = this.meta.version;
			}
			
            if (!currentVersionInfo.hasShownChangelog) {
                UI.showChangelogModal({
                    title: "VoiceMessages Changelog",
                    subtitle: config.changelog[0].title,
                    changes: [{
                        title: config.changelog[0].title,
                        type: "changed",
                        items: config.changelog[0].items
                    }]
                });
                currentVersionInfo.hasShownChangelog = true;
            }
			
			Data.save(this.meta.name, "currentVersionInfo", currentVersionInfo);
        }
        catch(err){
            Logger.error(this.meta.name, err);
        }
		this.saveAndUpdate();
	}

	stop() {
		Patcher.unpatchAll(this.meta.name);
		DOM.removeStyle(this.meta.name);
	}
};
// #endregion

/*@end@*/