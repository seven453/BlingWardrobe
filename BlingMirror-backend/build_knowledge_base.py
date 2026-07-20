import os
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

import glob
import chromadb
from chromadb.utils import embedding_functions

# ---------- 配置 ----------
KNOWLEDGE_DIR = "knowledge"          # 存放知识文本的文件夹（相对于当前目录）
DB_PATH = "./knowledge_db"           # 向量库持久化路径
CHUNK_SEP = "\n\n"                   # 按两个换行符切分知识块
MODEL_NAME = "all-MiniLM-L6-v2"      # 本地轻量 embedding 模型

def main():
    # 1. 初始化 embedding 函数（会自动下载模型，首次较慢）
    print("正在加载 embedding 模型...")
    embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(model_name=MODEL_NAME)
    print("模型加载完成。")

    # 2. 创建 Chroma 客户端（持久化）
    client = chromadb.PersistentClient(path=DB_PATH)

    # 3. 获取或创建集合（collection）
    collection = client.get_or_create_collection(
        name="style_knowledge",
        embedding_function=embed_fn
    )

    # 4. 读取知识文件夹中的所有 .txt 和 .md 文件
    file_paths = glob.glob(os.path.join(KNOWLEDGE_DIR, "*.txt")) + \
                 glob.glob(os.path.join(KNOWLEDGE_DIR, "*.md"))

    if not file_paths:
        print(f"❌ 在 {KNOWLEDGE_DIR} 文件夹下没有找到 .txt 或 .md 文件，请先放入知识文本。")
        return

    print(f"📂 找到 {len(file_paths)} 个知识文件：")
    for path in file_paths:
        print(f"   - {os.path.basename(path)}")

    all_chunks = []
    all_ids = []

    for file_idx, file_path in enumerate(file_paths):
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        # 按双换行切分成块
        chunks = content.split(CHUNK_SEP)
        for chunk_idx, chunk in enumerate(chunks):
            chunk = chunk.strip()
            if len(chunk) < 30:   # 忽略过短的段落
                continue
            doc_id = f"file{file_idx}_chunk{chunk_idx}"
            all_chunks.append(chunk)
            all_ids.append(doc_id)

    print(f"📖 共切分成 {len(all_chunks)} 个知识片段")

    if not all_chunks:
        print("⚠️ 没有有效的知识片段，请检查文件格式。")
        return

    # 5. 清空旧集合（每次重建全量替换）
    print("🧹 清空旧的向量库...")
    try:
        # 删除集合内所有数据
        existing_ids = collection.get()['ids']
        if existing_ids:
            collection.delete(ids=existing_ids)
    except Exception as e:
        print(f"清空时出错（可能是空集合）：{e}")

    # 6. 添加新数据
    print("正在添加知识块到向量库...")
    batch_size = 100
    for i in range(0, len(all_chunks), batch_size):
        batch_chunks = all_chunks[i:i+batch_size]
        batch_ids = all_ids[i:i+batch_size]
        collection.add(documents=batch_chunks, ids=batch_ids)
        print(f"已添加 {len(batch_chunks)} 条 (进度 {i+len(batch_chunks)}/{len(all_chunks)})")

    print(f"✅ 成功添加 {len(all_chunks)} 条知识到向量库！")
    print(f"💾 向量库持久化路径: {os.path.abspath(DB_PATH)}")

if __name__ == "__main__":
    main()