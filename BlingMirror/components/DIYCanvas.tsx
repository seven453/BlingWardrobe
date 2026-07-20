import React, { useState, useRef, useEffect } from 'react';
import { View, Button, Alert, StyleSheet, ActivityIndicator } from 'react-native';
import { BoardCanvas, BoardItemData } from 'react-native-skia-board';
import * as MediaLibrary from 'expo-media-library';
import { captureRef } from 'react-native-view-shot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute } from '@react-navigation/native';
import { removeBackground } from '../utils/removeBackground';

const DIY_STORAGE_KEY = (username: string) => `diy_projects_${username}`;

interface DIYCanvasProps {
  username: string;
}

export const DIYCanvas: React.FC<DIYCanvasProps> = ({ username }) => {
  const [items, setItems] = useState<BoardItemData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const viewRef = useRef<View>(null);
  const route = useRoute();

  // ---------- 持久化函数 ----------
  const saveCanvasData = async (username: string, items: BoardItemData[]) => {
    try {
      await AsyncStorage.setItem(DIY_STORAGE_KEY(username), JSON.stringify(items));
    } catch (error) {
      console.error('保存画布数据失败:', error);
    }
  };

  const loadCanvasData = async (username: string): Promise<BoardItemData[]> => {
    try {
      const data = await AsyncStorage.getItem(DIY_STORAGE_KEY(username));
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  };

  // ---------- 生命周期 ----------
  useEffect(() => {
    const loadData = async () => {
      const savedItems = await loadCanvasData(username);
      if (savedItems.length > 0) {
        setItems(savedItems);
      }
      setIsLoading(false);
    };
    loadData();
  }, [username]);

  // 每次 items 变化时保存（首次加载不保存）
  useEffect(() => {
    if (isLoading) return;
    saveCanvasData(username, items);
  }, [items, username, isLoading]);

  // 从衣橱传入图片时自动添加（修复类型错误）
  useEffect(() => {
    const params = route.params as { imageUri?: string; category?: string } | undefined;
    if (params?.imageUri) {
      (async () => {
        // 使用非空断言，因为上面已经检查过 imageUri 存在
        const transparentUri = await removeBackground(params.imageUri!);
        if (transparentUri) {
          addClothingToCanvas(transparentUri, params.category || '衣物');
        }
      })();
    }
  }, [route.params]);

  // ---------- 画布操作 ----------
  const loadImage = async (id: string): Promise<ArrayBuffer> => {
    const item = items.find(i => i.id === id);
    if (!item || item.type !== 'image') {
      throw new Error('Image not found');
    }
    // 使用 as any 访问自定义 data 字段
    const imageUri = (item as any).data?.imageUri;
    if (!imageUri) {
      throw new Error('Image URI not found');
    }
    const response = await fetch(imageUri);
    return response.arrayBuffer();
  };

  const addClothingToCanvas = (imageUri: string, category: string = '衣物') => {
    const newItem: BoardItemData = {
      id: Date.now().toString(),
      type: 'image',
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 200,
      width: 150,
      height: 150,
      data: { imageUri, category },
    } as any;
    setItems(prev => [...prev, newItem]);
  };

  const addTextToCanvas = (text: string = '输入你的穿搭灵感') => {
    const newItem: BoardItemData = {
      id: Date.now().toString(),
      type: 'text',
      text: text,
      fontSize: 24,
      x: 200,
      y: 200,
      width: 200,
      height: 60,
    };
    setItems(prev => [...prev, newItem]);
  };

  const saveDesign = async () => {
    if (!viewRef.current) return;
    try {
      const uri = await captureRef(viewRef.current, {
        format: 'png',
        quality: 1,
      });
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('需要权限', '请允许保存图片到相册');
        return;
      }
      const asset = await MediaLibrary.createAssetAsync(uri);
      await MediaLibrary.createAlbumAsync('Bling穿搭', asset, false);
      Alert.alert('成功', '穿搭图片已保存到相册！');
    } catch (error) {
      console.error('保存失败:', error);
      Alert.alert('失败', '保存图片失败，请重试');
    }
  };

  // 清空画布
  const clearCanvas = () => {
    Alert.alert('清空画布', '确定要清空所有内容吗？', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: () => setItems([]) },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#d4a5a5" />
      </View>
    );
  }

  return (
    <View ref={viewRef} style={styles.container}>
      <BoardCanvas
        items={items}
        loadImage={loadImage}
        onTransformEnd={(events) => {
          events.forEach(({ id, snapshot }) => {
            setItems(prev => prev.map(item =>
              item.id === id ? { ...item, ...snapshot } : item
            ));
          });
        }}
        actions={{
          onDelete: (id) => {
            setItems(prev => prev.filter(item => item.id !== id));
          },
        }}
      />
      <View style={styles.toolbar}>
        <Button title="添加文字" onPress={() => addTextToCanvas()} />
        <Button title="保存" onPress={saveDesign} />
        <Button title="清空" onPress={clearCanvas} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f0eb',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
});