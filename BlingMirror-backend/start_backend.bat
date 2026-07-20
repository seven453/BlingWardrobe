@echo off
cd /d C:\Users\seven\Desktop\BlingMirror-backend
call venv\Scripts\activate


set DEEPSEEK_API_KEY=YOUR_DEEPSEEK_API_KEY


set DASHSCOPE_API_KEY=sk-6f32d34fd9e14ac59d2b4bb9e16fc1a4


uvicorn main:app --reload --host 0.0.0.0 --port 8000
pause