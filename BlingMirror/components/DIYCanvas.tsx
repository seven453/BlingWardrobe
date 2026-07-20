import React, { useState, useRef, useEffect } from 'react';
import {
  View, Button, Alert, StyleSheet, ActivityIndicator, Modal,
  Text, TextInput, TouchableOpacity,
} from 'react-native';
import { BoardCanvas, BoardItemData } from 'react-native-skia-board';
import * as MediaLibrary from 'expo-media-library';
import { captureRef } from 'react-native-view-shot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute } from '@react-navigation/native';
import { removeBackground } from '../utils/removeBackground';

const DIY_STORAGE_KEY = (username: string) => `diy_projects_${username}`;
const DIY_BACKGROUND_KEY = (username: string) => `diy_background_${username}`;
const BACKGROUNDS = ['#F5F0EB', '#FFFFFF', '#E8E3DD', '#DDE4E1', '#E5DFE8', '#F0DFDF'];

interface DIYCanvasProps {
  username: string;
}

export const DIYCanvas: React.FC<DIYCanvasProps> = ({ username }) => {
  const [items, setItems] = useState<BoardItemData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [backgroundColor, setBackgroundColor] = useState(BACKGROUNDS[0]);
  const [textModalVisible, setTextModalVisible] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [undoStack, setUndoStack] = useState<BoardItemData[][]>([]);
  const [redoStack, setRedoStack] = useState<BoardItemData[][]>([]);
  const viewRef = useRef<View>(null);
  const lastImportedUri = useRef<string | null>(null);
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
      const [savedItems, savedBackground] = await Promise.all([
        loadCanvasData(username),
        AsyncStorage.getItem(DIY_BACKGROUND_KEY(username)),
      ]);
      if (savedItems.length > 0) {
        setItems(savedItems);
      }
      if (savedBackground) setBackgroundColor(savedBackground);
      setIsLoading(false);
    };
    loadData();
  }, [username]);

  // 每次 items 变化时保存（首次加载不保存）
  useEffect(() => {
    if (isLoading) return;
    saveCanvasData(username, items);
  }, [items, username, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      AsyncStorage.setItem(DIY_BACKGROUND_KEY(username), backgroundColor);
    }
  }, [backgroundColor, username, isLoading]);

  // 从衣橱传入图片时自动添加（修复类型错误）
  useEffect(() => {
    const params = route.params as { imageUri?: string; category?: string } | undefined;
    if (params?.imageUri && params.imageUri !== lastImportedUri.current) {
      lastImportedUri.current = params.imageUri;
      (async () => {
        // 使用非空断言，因为上面已经检查过 imageUri 存在
        const transparentUri = await removeBackground(params.imageUri!);
        if (transparentUri) {
          addClothingToCanvas(transparentUri, params.category || '衣物');
        }
      })();
    }
  }, [route.params]);

  const updateItems = (updater: (current: BoardItemData[]) => BoardItemData[]) => {
    setItems(current => {
      setUndoStack(stack => [...stack.slice(-19), current]);
      setRedoStack([]);
      return updater(current);
    });
  };

  const undo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack(stack => [...stack, items]);
    setUndoStack(stack => stack.slice(0, -1));
    setItems(previous);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(stack => [...stack, items]);
    setRedoStack(stack => stack.slice(0, -1));
    setItems(next);
  };

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
    updateItems(prev => [...prev, newItem]);
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
    updateItems(prev => [...prev, newItem]);
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
      { text: '清空', style: 'destructive', onPress: () => updateItems(() => []) },
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
    <View ref={viewRef} style={[styles.container, { backgroundColor }]}>
      <BoardCanvas
        items={items}
        loadImage={loadImage}
        onTransformEnd={(events) => {
          events.forEach(({ id, snapshot }) => {
            updateItems(prev => prev.map(item =>
              item.id === id ? { ...item, ...snapshot } : item
            ));
          });
        }}
        actions={{
          onDelete: (id) => {
            updateItems(prev => prev.filter(item => item.id !== id));
          },
        }}
      />
      <View style={styles.backgroundBar}>
        {BACKGROUNDS.map(color => (
          <TouchableOpacity
            key={color}
            accessibilityLabel={`画布背景 ${color}`}
            onPress={() => setBackgroundColor(color)}
            style={[
              styles.colorDot,
              { backgroundColor: color },
              color === backgroundColor && styles.selectedColor,
            ]}
          />
        ))}
      </View>
      <View style={styles.toolbar}>
        <Button title="撤销" onPress={undo} disabled={undoStack.length === 0} />
        <Button title="重做" onPress={redo} disabled={redoStack.length === 0} />
        <Button title="文字" onPress={() => setTextModalVisible(true)} />
        <Button title="导出" onPress={saveDesign} />
        <Button title="清空" onPress={clearCanvas} />
      </View>
      <Modal visible={textModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.textDialog}>
            <Text style={styles.dialogTitle}>添加文字标签</Text>
            <TextInput
              autoFocus
              maxLength={60}
              value={draftText}
              onChangeText={setDraftText}
              placeholder="输入你的穿搭灵感"
              style={styles.textInput}
            />
            <View style={styles.dialogActions}>
              <Button title="取消" onPress={() => setTextModalVisible(false)} />
              <Button title="添加" onPress={() => {
                const text = draftText.trim();
                if (!text) return;
                addTextToCanvas(text);
                setDraftText('');
                setTextModalVisible(false);
              }} />
            </View>
          </View>
        </View>
      </Modal>
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
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  backgroundBar: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    flexDirection: 'row',
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginHorizontal: 5,
    borderWidth: 1,
    borderColor: '#D8D0C8',
  },
  selectedColor: { borderWidth: 3, borderColor: '#9E7777' },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  textDialog: { backgroundColor: '#FFF', borderRadius: 16, padding: 20 },
  dialogTitle: { fontSize: 18, fontWeight: '600', marginBottom: 14, color: '#4A4A4A' },
  textInput: {
    borderWidth: 1,
    borderColor: '#E0D8D0',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  dialogActions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 16 },
});
