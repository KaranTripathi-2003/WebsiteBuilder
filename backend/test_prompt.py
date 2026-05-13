import os, json
from dotenv import load_dotenv
load_dotenv()
from groq import Groq
client = Groq(api_key=os.getenv('GROQ_API_KEY'))

SYSTEM_PROMPT = """You are an expert UI/UX Designer. Generate a stunning, fully responsive website.
OUTPUT FORMAT: ONLY valid JSON, no markdown: { "title": "...", "html": "...", "css": "...", "js": "..." }
- html: body inner content only. Use Tailwind CSS for ALL styling. Include sticky navbar, hero, services, testimonials, contact, footer.
- css: Minimal custom CSS only. No Tailwind duplicates.
- js: Vanilla JS for smooth scrolling, mobile nav, scroll-reveal.
- images: Use real Unsplash URLs. Never use placeholders."""

try:
    resp = client.chat.completions.create(
        model='llama-3.1-8b-instant',
        messages=[
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': 'coffee shop'}
        ],
        temperature=0.7,
        max_tokens=2500,
        response_format={'type': 'json_object'}
    )
    print('FINISH REASON:', resp.choices[0].finish_reason)
    print('RAW OUTPUT LENGTH:', len(resp.choices[0].message.content))
    print('RAW OUTPUT END:', resp.choices[0].message.content[-200:])
except Exception as e:
    print('ERROR:', e)
