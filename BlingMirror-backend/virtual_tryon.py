import os
import uuid
import httpx
import asyncio
import traceback
from fastapi import APIRouter, File, UploadFile, HTTPException
import oss2

router = APIRouter(prefix="/tryon", tags=["虚拟试穿"])

# ---------- 百炼 aitryon API 配置 ----------
DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY")

BAILIAN_ASYNC_API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis"
BAILIAN_QUERY_API_URL = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"

# ---------- OSS 配置 ----------
OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET")
OSS_ENDPOINT = os.environ.get("OSS_ENDPOINT")
OSS_BUCKET_NAME = os.environ.get("OSS_BUCKET_NAME")
bucket = None
if all([OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_ENDPOINT, OSS_BUCKET_NAME]):
    auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
    bucket = oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET_NAME)

async def upload_to_oss(file: UploadFile) -> str:
    """上传文件到 OSS，返回公网 URL"""
    if bucket is None:
        raise HTTPException(status_code=503, detail="OSS 服务尚未配置")
    filename = file.filename or "image.jpg"
    ext = filename.rsplit('.', 1)[-1] if '.' in filename else "jpg"
    object_name = f"tryon-images/{uuid.uuid4().hex}.{ext}"
    content = await file.read()
    try:
        # 使用 oss2 的 put_object 方法
        bucket.put_object(object_name, content)
        return f"https://{OSS_BUCKET_NAME}.{OSS_ENDPOINT}/{object_name}"
    except Exception as e:
        print(f"OSS 上传失败: {e}")
        raise HTTPException(status_code=500, detail=f"图片上传失败: {str(e)}")

async def query_task_result(task_id: str, max_attempts: int = 90) -> str:
    """轮询百炼任务状态，直到完成，返回生成的图片 URL"""
    headers = {"Authorization": f"Bearer {DASHSCOPE_API_KEY}"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        for _ in range(max_attempts):
            query_url = BAILIAN_QUERY_API_URL.format(task_id=task_id)
            response = await client.get(query_url, headers=headers)
            response.raise_for_status()
            result = response.json()
            status = result.get("output", {}).get("task_status")
            print(f"任务 {task_id} 状态: {status}")

            if status == "SUCCEEDED":
                return result.get("output", {}).get("image_url")
            elif status in ["FAILED", "UNKNOWN", "CANCELED"]:
                error_msg = result.get("output", {}).get("message", "未知错误")
                raise Exception(f"任务失败: {error_msg}")
            elif status in ["PENDING", "PRE-PROCESSING", "RUNNING", "POST-PROCESSING"]:
                await asyncio.sleep(2)
            else:
                raise Exception(f"未知任务状态: {status}")
        raise TimeoutError("虚拟试穿生成超时，请稍后重试")

@router.post("/")
async def virtual_tryon(
    person_image: UploadFile = File(...),
    top_image: UploadFile = File(...),
    bottom_image: UploadFile = File(None)
):
    if not DASHSCOPE_API_KEY:
        raise HTTPException(status_code=503, detail="虚拟试穿尚未配置 DASHSCOPE_API_KEY")
    if bucket is None:
        raise HTTPException(status_code=503, detail="虚拟试穿尚未配置 OSS 环境变量")

    try:
        # 1. 上传两张图片到 OSS
        person_url = await upload_to_oss(person_image)
        top_url = await upload_to_oss(top_image)
        bottom_url = await upload_to_oss(bottom_image) if bottom_image else None
        # 2. 构建百炼异步任务请求
        headers = {
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
            "X-DashScope-OssResourceResolve": "enable"
        }
        garment_input = {
            "person_image_url": person_url,
            "top_garment_url": top_url,
        }
        if bottom_url:
            garment_input["bottom_garment_url"] = bottom_url

        payload = {
            "model": "aitryon",
            "input": garment_input,
            "parameters": {
                "resolution": -1,
                "restore_face": True
            }
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(BAILIAN_ASYNC_API_URL, headers=headers, json=payload)
            response.raise_for_status()
            result = response.json()
            task_id = result.get("output", {}).get("task_id")
            if not task_id:
                return {"success": False, "error": f"未获取到 task_id，响应：{result}"}

            # 3. 轮询获取结果
            image_url = await query_task_result(task_id)
            return {"success": True, "image_url": image_url}

    except Exception as e:
        print("=== 虚拟试穿异常 ===")
        traceback.print_exc()
        return {"success": False, "error": str(e)}
