import { removeBgImage } from 'rn-remove-image-bg';

export const removeBackground = async (imageUri: string): Promise<string | null> => {
  try {
    // 返回透明背景的 PNG 图片路径
    const resultUri = await removeBgImage(imageUri, {
      maxDimension: 1024,   // 加快处理速度
      format: 'PNG',        // 透明背景需要 PNG
      useCache: true,       // 缓存结果
    });
    return resultUri;
  } catch (error) {
    console.error('抠图失败:', error);
    return null;
  }
};