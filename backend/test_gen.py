import os, sys
from dotenv import load_dotenv
load_dotenv()

from groq import Groq

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Import the actual system prompt from main
sys.path.insert(0, ".")
from main import SYSTEM_PROMPT

print(f"System prompt length: {len(SYSTEM_PROMPT)} chars / ~{len(SYSTEM_PROMPT)//4} tokens")

try:
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": "Build a complete professional website: coffee shop landing page"},
        ],
        temperature=0.7,
        max_tokens=6000,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content
    finish = resp.choices[0].finish_reason
    print(f"Finish reason: {finish}")
    print(f"Response length: {len(raw)} chars")
    print("First 300 chars:", raw[:300])
    import json
    data = json.loads(raw)
    print("JSON keys:", list(data.keys()))
    print("Title:", data.get("title"))
    print("HTML length:", len(data.get("html", "")))
    print("CSS length:", len(data.get("css", "")))
    print("JS length:", len(data.get("js", "")))
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")
