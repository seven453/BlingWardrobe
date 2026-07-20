import os
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
import json
import re
from openai import OpenAI
import chromadb
from chromadb.utils import embedding_functions

# ---------- 初始化 DeepSeek ----------
client = OpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY"),  
    base_url="https://api.deepseek.com"
)

# ---------- 初始化向量库 ----------
# 使用与构建时相同的 embedding 模型
embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")
# 连接到持久化的 Chroma 数据库（请确保路径正确）
CHROMA_PATH = "./knowledge_db"
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
try:
    collection = chroma_client.get_collection("style_knowledge", embedding_function=embed_fn)
    print(f"✅ 成功加载知识库，共 {collection.count()} 条知识")
except Exception as e:
    print(f"⚠️ 知识库加载失败: {e}，请先运行 build_knowledge_base.py 构建向量库")
    collection = None

def retrieve_knowledge(query: str, top_k: int = 3) -> str:
    """根据查询字符串检索最相关的知识片段，返回拼接后的文本"""
    if collection.count() == 0:
        return ""
    try:
        results = collection.query(query_texts=[query], n_results=top_k)
        if results['documents'] and results['documents'][0]:
            return "\n\n".join(results['documents'][0])
    except Exception as e:
        print(f"检索知识失败: {e}")
    return ""
def get_ai_outfit_recommendation(weather: dict, wardrobe_items: list, user_query: str = None, user_profile: dict = None):
    print(f"后端收到的 user_profile: {user_profile}")
    if user_profile:
        print(f"风格: {user_profile.get('style')}, 场景: {user_profile.get('scene')}")
    if user_profile is None:
        user_profile = {}

    # 构建衣橱文本（限制数量避免超长）
    wardrobe_text = "\n".join([f"- {item.get('category')}: {item.get('color')}" for item in wardrobe_items[:30]])

    # 构建检索查询词
    weather_desc = weather.get('description', '')
    style = user_profile.get('style', '')
    scene = user_profile.get('scene', '')
    search_query = f"{weather_desc} {style} {scene} 穿搭"
    knowledge = retrieve_knowledge(search_query)
    knowledge_section = f"\n[参考穿搭知识]\n{knowledge}\n" if knowledge else ""

    # 构建完整 prompt
    prompt = f"""你是一位专业的时尚造型顾问。

[用户画像]
- 体型特征：{user_profile.get('body_shape', user_profile.get('bodyShape', '未提供'))}
- 风格偏好：{style}
- 颜色偏好：{user_profile.get('color_preference', user_profile.get('colorPreference', '未提供'))}
- 特殊要求：{user_profile.get('special_request', user_profile.get('specialRequest', '未提供'))}

[穿搭约束]
- 场景：{user_query or scene or '日常通勤'}

{knowledge_section}

[当前衣橱]
{wardrobe_text}

[天气情况]
{weather.get('temp')}°C，{weather_desc}

请严格按照以下 JSON 格式输出搭配建议：
{{"top":"上衣","bottom":"下装","shoes":"鞋子","reason":"推荐理由","style_tips":"风格小贴士"}}

要求：
- 优先使用衣橱中的衣物。
- 如果某类别缺失，可以推荐外部单品并说明理由。
- 参考上面提供的“参考穿搭知识”，尽量贴合其中的搭配理念和实例。
"""

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "你是一个专业的时尚搭配师，只返回JSON格式的数据。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=1000
        )
        result_text = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', result_text)
        if json_match:
            return json.loads(json_match.group())
        else:
            return {"error": "无法解析AI响应", "raw": result_text}
    except Exception as e:
        return {"error": str(e)}