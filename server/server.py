from flask import Flask, request, jsonify
from bson import ObjectId
from llm import generate_code

app = Flask(__name__)


@app.route("/ai", methods=["POST"])
def post():
    data = request.get_json()
    diff = data.get("diff", "")
    branch_name = data.get("branch_name", "main")
    last_history = data.get("last_history", "None")
    conventions = data.get("conventions", "None")
    last_suggests = data.get('last_suggests', 'no one yet')
    api_key = request.headers.get("X-Api-Key", None)
    if not diff or not api_key:
        return jsonify({"error": "Missing required fields"}), 400
    try:
        commit_messages = generate_code(
            diff,
            branch_name,
            last_history,
            conventions,
            last_suggests,
            api_key,
        )
        return jsonify({"commit_messages": commit_messages}), 200
    except Exception as e:
        print(e)
        return jsonify({"error": str(e)}), 500


app.run(host='0.0.0.0', port=8080)
