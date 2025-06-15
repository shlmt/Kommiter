from langchain_groq.chat_models import ChatGroq
from langchain.prompts import ChatPromptTemplate
import re
import emoji

code_template = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are a helpful AI assistant that generates commit messages for code changes with professional tone. "
            "Follow universally accepted conventions:\n"
            "use the imperative mood (e.g., Fix bug, Add feature), "
            "keep it under 50 characters, avoid ending punctuation, use lowercase unless capitalizing proper names or acronyms, "
            "and make it concise and specific. "
            "Specifically, generate commit messages based on the following conventions:\n{conventions}\n"
            "Don't repeat on commit messages. Dont add any extra text, just the commit messages.\n",
        ),
        (
            "human",
            "Generate new 4 commit messages for the branch '{branch_name}', that are not duplicates of the previous suggestions: {last_suggests}, "
            "with the following last commits history (if exist):\n{history}\n"
            "Separate them with new lines. Don't add any extra text.\n"
            "For the following code changes, detect the 1-2 main changes:\n{diff}\n",
        ),
    ]
)

commit_conventions = {
    "Conventional Commits": (
        "Use the format '<type>(<optional scope>): <subject>' in imperative mood. "
        "Use types like feat, fix, chore, docs, style, refactor, test, perf. "
        "Keep subject concise and under 50 characters."
    ),
    "Gitmoji": (
        "Start the commit message with an emoji code alias representing the change type, "
        "followed by a concise subject line in imperative mood. (e.g ':sparkles: add new feature'). "
    ),
    "JIRA-style": (
        "Prefix the commit message with the issue ID (e.g., 'PROJ-123'), followed by "
        "a concise imperative subject describing the change. Example: 'PROJ-123 fix login timeout'."
    ),
    "Scoped Commits": (
        "Prefix the subject with the scope of the change (e.g., module or package), "
        "followed by a colon and a concise imperative subject. Example: 'api: add rate limiting'."
    ),
}


def process_emoji_message(message):
    match = re.match(r"^(:[\w+-]+:)(.*)$", message)
    if not match:
        return message
    code, rest = match.groups()
    emoji_char = emoji.emojize(code, language="alias")
    if emoji_char != code:
        return f"{code}{emoji_char}{rest}"
    else:
        print(code)
        print(emoji.emojize(code))
        return rest


def generate_code(
    diff: str,
    branch_name: str,
    last_history: str,
    convention: str,
    last_suggest: str,
    api_key: str,
) -> str:
    prompt = code_template.format_prompt(
        diff=diff,
        history=last_history,
        conventions=commit_conventions.get(
            convention, "User-defined convention: " + convention
        ),
        branch_name=branch_name,
        last_suggests=last_suggest,
    )
    llm = ChatGroq(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        api_key=api_key,
        temperature=0.6,
        max_tokens=1024,
    )
    response = llm.invoke(prompt)
    if convention == "Gitmoji":
        return "\n".join(map(process_emoji_message, response.content.split('\n'))) if response else ""
    return response.content if response else ""


if __name__ == "__main__":
    from dotenv import load_dotenv
    groq_api_key = load_dotenv().get("GROQ_API_KEY")

    example_diff = "diff --git a/example.py b/example.py\n index 83db48f..f735c3a 100644\n--- a/example.py\n +++ b/example.py\n @@ -1,3 +1,4 @@\n def example_function():\n-    print('Hello World')\n+    print('Hello, World!')\n+    return True\n"
    example_history = "ce6846c (HEAD -> master) init project"
    example_convention = "Conventional Commits"
    example_branch = "extension"
    example_api_key = groq_api_key

    print(
        generate_code(
            example_diff,
            example_branch,
            example_history,
            example_convention,
            "no one yet",
            example_api_key,
        )
    )
