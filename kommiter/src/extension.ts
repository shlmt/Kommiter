import * as vscode from 'vscode'
import { promisify } from 'util'
import { exec } from 'child_process'
import path from 'path'
import { readFile, writeFile } from 'fs/promises'
const execAsync = promisify(exec)

const API_URL = 'http://localhost:8080/ai'

export async function activate(context: vscode.ExtensionContext) {
	let apiKey = vscode.workspace.getConfiguration().get<string>('komitter.apiKey')
	if (!apiKey) {
		apiKey = await vscode.window.showInputBox({
			prompt: "Enter your Groq API key (it's free)",
			placeHolder: 'gsk-...',
			ignoreFocusOut: true,
			password: true
		})
		if (apiKey) {
			try {
				await vscode.workspace.getConfiguration().update('komitter.apiKey', apiKey, vscode.ConfigurationTarget.Global)
				vscode.window.showInformationMessage('API Key saved successfully.')
			} catch (err) {
				console.error('Failed to save API key:', err)
				vscode.window.showErrorMessage('Failed to save API key.')
				return
			}
		}
	}
	const kommiter = vscode.commands.registerCommand('kommiter.kommiter', async () => {
		if (!apiKey) {
			vscode.window.showErrorMessage("No API Key entered. I can't work.")
			return
		}
		let gitDiff, gitLogHistory, currBranchName
		try {
			const { stdout: diff } = await execAsync('git diff --staged', { cwd: vscode.workspace.rootPath })
			gitDiff = diff
		} catch (err) {
			vscode.window.showErrorMessage('Error running git diff')
			return
		}
		if (!gitDiff || gitDiff == '') {
			vscode.window.showErrorMessage('No changes to commit. Please make some changes first.')
			return
		}
		try {
			const { stdout: log } = await execAsync('git log -10 --oneline', { cwd: vscode.workspace.rootPath })
			gitLogHistory = log
		} catch (err) {
			console.warn(err)
			vscode.window.showWarningMessage('Error running git log. Continue without')
		}
		try {
			const { stdout: branchName } = await execAsync('git branch --show-current', { cwd: vscode.workspace.rootPath })
			currBranchName = branchName.trim()
		} catch (err) {
			vscode.window.showWarningMessage('Error getting current branch name. Continue without')
		}
		const convention = await getConvention()
		let selectedMessage: string | undefined = 'fetch more'
		let commitMessages: string[] = []
		let lastSuggests = ''
		while (selectedMessage && selectedMessage == 'fetch more') {
			lastSuggests = lastSuggests + '* ' + commitMessages.join(', * ')
			const recommendations = await callLlm(apiKey!, gitDiff, gitLogHistory, currBranchName, convention, lastSuggests)
			commitMessages = commitMessages.concat(recommendations)
			selectedMessage = await vscode.window.showQuickPick([...commitMessages, 'fetch more'], {
				placeHolder: 'Select a commit message or request new ones',
				canPickMany: false
			})
		}
		if (selectedMessage) {
			exec(`git commit -m "${selectedMessage.replace(/"/g, '\\"')}"`, { cwd: vscode.workspace.rootPath }, (err) => {
				if (err) {
					vscode.window.showErrorMessage('Error creating commit')
					return
				}
				vscode.window.showInformationMessage(`Commit created with message: ${selectedMessage}`)
			})
		}
	})
	context.subscriptions.push(kommiter)
}

export async function getConvention(): Promise<string | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders
	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage('No workspace is open.')
		return
	}
	const settingsPath = path.join(workspaceFolders[0].uri.fsPath, 'kommitter.settings.json')
	let convention: string | undefined
	try {
		const data = await readFile(settingsPath, 'utf-8')
		const settings = JSON.parse(data)
		if (settings.commitConvention && typeof settings.commitConvention === 'string') {
			return settings.commitConvention
		}
	} catch {}
	const predefined = ['Conventional Commits', 'Gitmoji', 'JIRA-style', 'Scoped Commits', 'Other']
	const selected = await vscode.window.showQuickPick(predefined, {
		placeHolder: 'Select a commit convention or choose Other to define your own'
	})
	if (!selected) return undefined
	convention = selected
	if (selected === 'Other') {
		const input = await vscode.window.showInputBox({
			prompt: 'Enter your custom commit convention',
			validateInput: (val) => (val.trim() === '' ? 'Convention cannot be empty' : null)
		})
		if (!input) return undefined
		convention = input.trim()
	}
	try {
		await writeFile(settingsPath, JSON.stringify({ commitConvention: convention }, null, 2), 'utf-8')
	} catch {}
	return convention
}

async function callLlm(
	apiKey: string,
	gitDiff: string,
	gitLogHistory?: string,
	branchName?: string,
	conventions?: string,
	lastSuggests?: string
) {
	const query = {
		diff: gitDiff,
		last_history: gitLogHistory,
		branch_name: branchName || 'main',
		conventions: conventions,
		lastSuggests: lastSuggests
	}
	const llmResponse = await fetch(API_URL, {
		method: 'POST',
		body: JSON.stringify(query),
		headers: {
			'Content-Type': 'application/json',
			'X-Api-Key': apiKey
		}
	})
	if (!llmResponse.ok) {
		throw new Error(`Error: ${llmResponse.statusText}`)
	}
	const { commit_messages }: any = await llmResponse.json()
	if (!commit_messages) {
		return
	}
	return commit_messages
		.split('\n')
		.map((msg: string) => msg.trim())
		.filter((msg: string) => msg.length > 0)
}

