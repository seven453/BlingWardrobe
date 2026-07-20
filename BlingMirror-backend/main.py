import os
import httpx
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from ai_service import get_ai_outfit_recommendation
from virtual_tryon import router as tryon_router

# -------------------- 初始化 FastAPI --------------------
app = FastAPI(title="Bling Wardrobe API", description="AI 穿搭助手后端")

# 允许跨域（方便前端开发调试）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------- 挂载静态文件服务（用于临时图片） --------------------
TEMP_UPLOAD_DIR = "temp_uploads"
os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=TEMP_UPLOAD_DIR), name="static")

# -------------------- 挂载虚拟试穿路由 --------------------
app.include_router(tryon_router)

# -------------------- 高德天气配置 --------------------
AMAP_API_KEY = os.environ.get("AMAP_API_KEY")

# -------------------- 根路径 --------------------
@app.get("/")
def root():
    return {"message": "Bling Wardrobe API is running"}

# -------------------- 天气接口（高德地图） --------------------
@app.get("/weather")
async def get_weather(
    lat: float = Query(..., description="纬度"),
    lon: float = Query(..., description="经度")
):
    """
    根据经纬度获取实时天气并生成穿搭建议
    """
    if not AMAP_API_KEY:
        raise HTTPException(status_code=503, detail="天气服务尚未配置 AMAP_API_KEY")

    try:
        # 1. 地理编码：经纬度转城市 adcode
        geocode_url = f"https://restapi.amap.com/v3/geocode/regeo?output=json&location={lon},{lat}&key={AMAP_API_KEY}"
        async with httpx.AsyncClient() as client:
            geo_resp = await client.get(geocode_url, timeout=10.0)
            if geo_resp.status_code != 200:
                return {"error": f"地理编码服务失败，HTTP状态码: {geo_resp.status_code}"}
            geo_data = geo_resp.json()
            if geo_data.get("status") != "1":
                return {"error": f"地理编码失败，错误信息: {geo_data.get('info')}"}
            city_code = geo_data.get("regeocode", {}).get("addressComponent", {}).get("adcode")
            if not city_code or len(city_code) != 6:
                return {"error": f"无法获取城市代码，返回数据: {geo_data}"}

        # 2. 天气查询：使用 adcode 获取实时天气
        weather_url = f"https://restapi.amap.com/v3/weather/weatherInfo?city={city_code}&key={AMAP_API_KEY}&extensions=base"
        async with httpx.AsyncClient() as client:
            weather_resp = await client.get(weather_url, timeout=10.0)
            if weather_resp.status_code != 200:
                return {"error": f"天气服务失败，HTTP状态码: {weather_resp.status_code}"}
            weather_data = weather_resp.json()
            if weather_data.get("status") != "1":
                return {"error": f"天气查询失败，错误信息: {weather_data.get('info')}"}
            lives = weather_data.get("lives", [])
            if not lives:
                return {"error": f"未找到天气数据，返回数据: {weather_data}"}
            live = lives[0]
            # 提取核心数据
            temp = live.get("temperature_float")
            try:
                temp = float(temp)
            except (TypeError, ValueError):
                temp = 0.0
            description = live.get("weather", "未知")
            # 根据温度生成穿搭建议
            if temp > 28:
                advice = "天气炎热，建议穿短袖、短裤、裙子"
            elif temp > 22:
                advice = "温暖舒适，适合穿T恤、薄衬衫"
            elif temp > 15:
                advice = "微凉，建议加一件薄外套"
            elif temp > 5:
                advice = "较冷，穿毛衣或厚外套"
            else:
                advice = "寒冷，注意保暖，穿羽绒服"
            return {"temp": temp, "description": description, "advice": advice}

    except httpx.TimeoutException:
        return {"error": "调用高德服务超时，请稍后重试"}
    except Exception as e:
        return {"error": f"内部处理错误: {str(e)}"}


# -------------------- AI 推荐接口（含RAG） --------------------
@app.post("/ai-recommend")
async def ai_recommend(request: dict):
    """
    接收前端传来的天气、衣橱、用户偏好，调用 DeepSeek 模型生成穿搭建议
    内部已集成 RAG 知识库检索（如已构建向量库）
    """
    weather = request.get("weather", {})
    wardrobe = request.get("wardrobe", [])
    query = request.get("query")
    user_profile = request.get("user_profile", {})

    if not wardrobe:
        return {"success": False, "error": "衣橱为空，请先添加衣物"}

    try:
        recommendation = get_ai_outfit_recommendation(weather, wardrobe, query, user_profile)
        return {"success": True, "recommendation": recommendation}
    except Exception as e:
        return {"success": False, "error": str(e)}


# -------------------- 可选：测试用端点 --------------------
@app.get("/ping")
def ping():
    return {"pong": True}

# -------------------- 启动说明 --------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
