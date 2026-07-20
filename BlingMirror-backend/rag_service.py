import chromadb
from chromadb.utils import embedding_functions
import hashlib

# 使用本地轻量级 embedding 函数（不需要 API key）
ef = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")

# 初始化 ChromaDB 客户端（持久化到本地 ./chroma_data 目录）
client = chromadb.PersistentClient(path="./chroma_data")

def get_or_create_collection(user_id: str):
    """为每个用户创建独立的 collection"""
    collection_name = f"user_style_{hashlib.md5(user_id.encode()).hexdigest()[:16]}"
    return client.get_or_create_collection(
        name=collection_name,
        embedding_function=ef
    )

def add_outfit_to_memory(user_id: str, outfit_text: str, metadata: dict):
    """保存一次穿搭记录到向量库"""
    collection = get_or_create_collection(user_id)
    collection.add(
        documents=[outfit_text],
        metadatas=[metadata],
        ids=[f"{user_id}_{metadata.get('date', '')}"]
    )

def query_similar_outfits(user_id: str, query_text: str, n_results: int = 3):
    """根据查询文本，找到最相似的过往穿搭"""
    collection = get_or_create_collection(user_id)
    results = collection.query(query_texts=[query_text], n_results=n_results)
    return results['documents'][0] if results['documents'] else []