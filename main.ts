import {Editor, Plugin, TFile,} from "obsidian";
import {EditorView, ViewUpdate} from "@codemirror/view";
import SlashSnippetSettingTab from "./SlashSnippetSettingTab";
import SlashSuggestions from "./SlashSuggestions";


interface SlashSnippetSettings {
	slashTrigger: string;
	fuzzySearch: boolean;
	highlight: boolean;
	showPath: boolean;
	showFileContent: boolean;
	snippetPath: string;
	relativePathSearch: boolean;
	ignoreProperties: boolean;
	templaterSupport: boolean;
	textSelectionString: string;
	cursorPositionString: string;
	maxSelectedTextLength: number;
	showSelectedText: boolean;
}


const DEFAULT_SETTINGS: SlashSnippetSettings = {
	slashTrigger: "/",
	fuzzySearch: true,
	highlight: true,
	showPath: false,
	showFileContent: false,
	snippetPath: "Snippets",
	relativePathSearch: false,
	ignoreProperties: true,
	templaterSupport: true,
	textSelectionString: "%%textSelection%%",
	cursorPositionString: "%%cursor%%",
	maxSelectedTextLength: 50,
	showSelectedText: false
};

export interface SuggestionObject {
	filePath: string;
	positions: number[];
	score: number;
}


export default class SlashSnippetPlugin extends Plugin {
	settings: SlashSnippetSettings;
	selectedText = '';
	snippetFiles: TFile[] = [];

	async onload() {
		await this.loadSettings();
		this.registerEditorSuggest(new SlashSuggestions(this));
		this.addSettingTab(new SlashSnippetSettingTab(this.app, this));
		this.loadAllTemplatedFiles();
		this.listenForUpdates();

		// keep text selection updated
		const mySelectionListener = EditorView.updateListener.of((update: ViewUpdate) => {
			if (!update.docChanged) return;

			let selectionCaptured = false;
			for (const tr of update.transactions) {
				const changes = tr.changes;
				changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
					const deletedText = tr.startState.doc.sliceString(fromA, toA);
					const insertedText = inserted.toString();

					// update selected text
					if (deletedText.length > 0 && insertedText === this.settings.slashTrigger) {
						selectionCaptured = true;
						this.selectedText = deletedText;
					}
				});
			}

			// Clear selected text after non-slash edits
			if (!selectionCaptured) {
				this.selectedText = '';
			}
		});
		this.registerEditorExtension(mySelectionListener);
	}

	loadAllTemplatedFiles() {
		const files = this.app.vault.getMarkdownFiles();
		const snippets = []

		for (let i = 0; i < files.length; i++) {
			const file = files[i];

			if (file.path.startsWith(`${this.settings.snippetPath}/`)) {
				snippets.push(file);
				//
				const oldScore = localStorage.getItem(file.path);
				if (!oldScore) {
					// default score
					const timestamp = Date.now();
					localStorage.setItem(file.path, String(timestamp));
				}
			}
		}

		this.snippetFiles = snippets;
	}

	listenForUpdates() {
		this.registerEvent(this.app.vault.on('create', (file) => {
			if (
				file instanceof TFile &&
				file.path.startsWith(`${this.settings.snippetPath}/`)
			) {
				this.snippetFiles.push(file);

				const oldScore = localStorage.getItem(file.path);
				if (!oldScore) {
					// default score
					const timestamp = Date.now();
					localStorage.setItem(file.path, String(timestamp));
				}
			}
		}));

		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (
				file instanceof TFile &&
				file.path.startsWith(`${this.settings.snippetPath}/`)
			) {
				this.snippetFiles.remove(file);
				// remove score
				localStorage.removeItem(file.path);
			}
		}));
	}


	public async runTemplaterReplace(file: TFile, editor: Editor) {
		const templaterReplaceCommandId = "templater-obsidian:replace-in-file-templater";

		// avoid the "editor:save-file" command because save hooks may modify the editor content
		const editorContent = editor.getValue();
		await this.app.vault.modify(file, editorContent);

		// Templater reads and replaces the active file through the Vault
		(this.app as any).commands.executeCommandById(templaterReplaceCommandId);
	}


	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
