import {
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile
} from "obsidian";
import SlashSnippetPlugin, {SuggestionObject} from "./main";

export default class SlashSuggestions extends EditorSuggest<SuggestionObject> {
	private plugin: SlashSnippetPlugin;
	private DEFAULT_SCORE = 1;
	private START_WITH_SCORE = 2;
	private activeTriggerStart: number | null = null;

	private getSnippetName(file: TFile): string {
		if (!this.plugin.settings.relativePathSearch) {
			return file.basename;
		}

		const snippetPath = this.plugin.settings.snippetPath
			.replace(/\\/g, "/")
			.replace(/^\/+|\/+$/g, "");
		const filePath = file.path.replace(/\\/g, "/");
		const prefix = snippetPath ? `${snippetPath}/` : "";
		const relativePath = filePath.startsWith(prefix)
			? filePath.slice(prefix.length)
			: filePath;
		const extension = file.extension;
		const extensionWithDot = extension ? `.${extension}` : "";

		return extensionWithDot && relativePath.endsWith(extensionWithDot)
			? relativePath.slice(0, -extensionWithDot.length)
			: relativePath;
	}

	getAllSnippets(query: string) {
		if (query.startsWith(" ")) {
			return []
		}

		// if nothing is query yet
		if (query == "") {
			return this.getLastUsedSnippetFiles();
		}

		// search rank
		const snippetFiles: SuggestionObject[] = [];

		for (let i = 0; i < this.plugin.snippetFiles.length; i++) {
			const file = this.plugin.snippetFiles[i];
			const snippetName = this.getSnippetName(file);
			let score = 0;

			if (this.plugin.settings.fuzzySearch) {
				let positions = this.fuzzyMatch(snippetName, query);
				// if fuzzy match starts with query then have higher score
				if (snippetName.startsWith(query)) {
					score = this.START_WITH_SCORE;
				} else {
					score = this.DEFAULT_SCORE;
				}

				if (positions) {
					snippetFiles.push({
						filePath: file.path,
						positions: positions,
						score: score
					});
				}

			} else {
				if (snippetName.toLowerCase().contains(query.toLowerCase())) {
					score = this.DEFAULT_SCORE;
					snippetFiles.push({
						filePath: file.path,
						positions: [],
						score: score
					})

				}
			}
		}

		snippetFiles.sort((a, b) => b.score - a.score);
		return snippetFiles;

	}

	fuzzyMatch(text: string, query: string) {
		let t = 0, q = 0;
		let positions: number[] = []
		text = text.toLowerCase();
		query = query.toLowerCase();


		while (t < text.length && q < query.length) {
			if (text[t] === query[q]) {
				q++;
				if (this.plugin.settings.highlight) {
					positions.push(t);
				}
			}
			t++;
		}


		if (q === query.length) {
			// return position if highlight enabled
			if (this.plugin.settings.highlight) {
				return positions;
			} else {
				return [];
			}

		} else {
			return false
		}
	}


	getSuggestions(context: EditorSuggestContext): SuggestionObject[] | Promise<SuggestionObject[]> {
		return this.getAllSnippets(context.query)
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile | null
	): EditorSuggestTriggerInfo | null {
		const textBeforeCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
		const trigger = this.plugin.settings.slashTrigger;

		// keep the existing trigger active while editing its query
		if (
			this.activeTriggerStart !== null &&
			this.activeTriggerStart < cursor.ch &&
			textBeforeCursor[this.activeTriggerStart] === trigger
		) {
			return {
				start: {
					...cursor,
					ch: this.activeTriggerStart
				},
				end: cursor,
				query: textBeforeCursor.slice(this.activeTriggerStart + 1)
			};
		}

		this.activeTriggerStart = null;

		// start a new trigger only when the trigger character was just entered
		if (
			cursor.ch > 0 &&
			textBeforeCursor[cursor.ch - 1] === trigger
		) {
			this.activeTriggerStart = cursor.ch - 1;
			return {
				start: {
					...cursor,
					ch: this.activeTriggerStart
				},
				end: cursor,
				query: ""
			};
		}

		return null;
	}

	private removeFrontmatter(content: string) {
		if (!content) {
			return "";
		}
		if (!this.plugin.settings.ignoreProperties) {
			return content;
		}
		if (content.startsWith("---")) {
			return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
		}
		return content;
	}

	public async selectSuggestion(suggestion: SuggestionObject, evt: MouseEvent) {
		const file = this.plugin.app.vault.getFileByPath(suggestion.filePath);
		if (!file) return
		const fileContent = await this.plugin.app.vault.cachedRead(file);
		let snippetContent = this.removeFrontmatter(fileContent);

		const textSelectionPos = snippetContent.indexOf(this.plugin.settings.textSelectionString);
		console.log(`textSelectionPos ${textSelectionPos}`);

		// cursor position hop
		const cursorTextPos = snippetContent.indexOf(this.plugin.settings.cursorPositionString);
		// remove cursor text
		if (cursorTextPos) {
			snippetContent = snippetContent.replace(this.plugin.settings.cursorPositionString, "")
		}

		// replace with past text selection
		if (this.plugin.selectedText) {
			snippetContent = snippetContent.replace(this.plugin.settings.textSelectionString, this.plugin.selectedText);
		} else {
			snippetContent = snippetContent.replace(this.plugin.settings.textSelectionString, "");
		}
		this.plugin.selectedText = "";
		//
		this.context?.editor.replaceRange(
			snippetContent,
			this.context.start,
			this.context.end
		);

		if (cursorTextPos && cursorTextPos >0) {
			this.context?.editor.setCursor({
				line: this.context?.start.line,
				ch: this.context?.start.ch + cursorTextPos
			});
		}else if(textSelectionPos){
			this.context?.editor.setCursor({
				line: this.context?.start.line,
				ch: this.context?.start.ch + textSelectionPos
			});
		}


		// run templater
		if (this.plugin.settings.templaterSupport) {
			await this.plugin.runTemplaterReplace();
		}

		// update last used timestamp
		localStorage.setItem(suggestion.filePath, String(Date.now()));
		this.close();
	}

	public close(): void {
		this.activeTriggerStart = null;
		super.close();
	}

	getLastUsedSnippetFiles(): SuggestionObject[] {
		const snippets: SuggestionObject[] = [];

		this.plugin.snippetFiles.map(snippet => {
			const timestamp = localStorage.getItem(snippet.path);
			const suggestionObject = {
				filePath: snippet.path,
				positions: [],
				score: timestamp ? Number(timestamp) : 0,
			}
			snippets.push(suggestionObject);
		});

		snippets.sort((a, b) => b.score - a.score);
		return snippets;
	}


	buildHighlighted(text: string, positions: number[]) {
		let out = "";

		for (let i = 0; i < text.length; i++) {
			if (positions.includes(i)) {
				out += `<b class="slash-fuzzy-match">${text[i]}</b>`;
			} else {
				out += text[i];
			}
		}

		return out;
	}

	// Renders each suggestion item.
	async renderSuggestion(suggestion: SuggestionObject, el: HTMLElement) {
		const file = this.plugin.app.vault.getFileByPath(suggestion.filePath);
		if (!file) return
		const fileContent = await this.plugin.app.vault.cachedRead(file);

		const pos = suggestion.positions;
		const snippetName = this.getSnippetName(file);

		// highlight match
		if (this.plugin.settings.highlight && pos) {
			const title = el.createEl("div");
			title.innerHTML = this.buildHighlighted(snippetName, pos);

		} else {
			el.createEl("div", {text: snippetName});
		}

		// show path
		if (this.plugin.settings.showPath) {
			el.createEl("small", {cls: "slash-path", text: suggestion.filePath});
		}

		// show file content
		if (this.plugin.settings.showFileContent) {
			el.createDiv({cls: "slash-file"})
				.createEl("small", {cls: "slash-file-content", text: fileContent.trim()});
		}

		if (this.plugin.settings.showSelectedText &&
			this.plugin.selectedText &&
			fileContent.contains(this.plugin.settings.textSelectionString)) {

			let insertText = ""

			if (this.plugin.selectedText.length > this.plugin.settings.maxSelectedTextLength) {
				insertText = `${this.plugin.selectedText.substring(0, this.plugin.settings.maxSelectedTextLength).trim()}...`;
			} else {
				insertText = this.plugin.selectedText.substring(0, 10).trim();
			}

			el.createEl('small', {text: insertText, cls: "insert_text"});
		}

	}

	constructor(app: SlashSnippetPlugin) {
		super(app.app);
		this.plugin = app;
	}

	public unload(): void {
	}

}
