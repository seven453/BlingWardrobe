import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity,
  Modal, TextInput, Button, Alert, ActivityIndicator, ScrollView
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { DIYCanvas } from './components/DIYCanvas';
const BottomTab = createBottomTabNavigator();

// ========== 类型定义 ==========
interface UserInfo {
  username: string;
  password: string;
  nickname: string;
  createdAt: string;
}

interface ClothingItem {
  id: string;
  imageUri: string;
  category: string;
  color: string;
  note?: string;
}

// ========== 用户存储工具函数 ==========
const USERS_STORAGE_KEY = 'bling_users';
const CURRENT_USER_KEY = 'bling_current_user';

const getUsers = async (): Promise<UserInfo[]> => {
  try {
    const raw = await AsyncStorage.getItem(USERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

const saveUsers = async (users: UserInfo[]) => {
  await AsyncStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
};

const getCurrentUser = async (): Promise<string | null> => {
  return await AsyncStorage.getItem(CURRENT_USER_KEY);
};

const setCurrentUser = async (username: string) => {
  await AsyncStorage.setItem(CURRENT_USER_KEY, username);
};

const clearCurrentUser = async () => {
  await AsyncStorage.removeItem(CURRENT_USER_KEY);
};

const getUserClothesKey = (username: string) => `clothes_${username}`;

// 后端地址（USB调试模式用 localhost）
const API_BASE_URL = 'http://8.137.218.104:8000';

// 搭配历史相关
const getOutfitHistoryKey = (username: string) => `outfit_history_${username}`;

// 保存一条搭配记录
const saveOutfitToHistory = async (username: string, outfit: {
  top?: ClothingItem;
  bottom?: ClothingItem;
  shoes?: ClothingItem;
}, type: string, weather: any, note?: string) => {
  try {
    const key = getOutfitHistoryKey(username);
    const existing = await AsyncStorage.getItem(key);
    const history = existing ? JSON.parse(existing) : [];
    const newRecord = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      top: outfit.top || null,
      bottom: outfit.bottom || null,
      shoes: outfit.shoes || null,
      type,
      weather: weather ? { temp: weather.temp, description: weather.description } : null,
      note: note || ''
    };
    history.unshift(newRecord); // 最新的放在最前面
    await AsyncStorage.setItem(key, JSON.stringify(history));
    return true;
  } catch (error) {
    console.error('保存搭配失败:', error);
    return false;
  }
};

// 获取搭配历史
const getOutfitHistory = async (username: string) => {
  try {
    const key = getOutfitHistoryKey(username);
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

// 删除指定搭配记录
const deleteOutfitFromHistory = async (username: string, recordId: string) => {
  try {
    const key = getOutfitHistoryKey(username);
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      let history = JSON.parse(raw);
      history = history.filter((item: any) => item.id !== recordId);
      await AsyncStorage.setItem(key, JSON.stringify(history));
    }
  } catch (error) {
    console.error('删除搭配失败:', error);
  }
};
// ========== 压箱底衣物统计 ==========
interface UnusedClothingItem extends ClothingItem {
  lastUsedDate?: string;  // 最后使用日期
  usageCount: number;      // 使用次数
}

/**
 * 获取用户的“压箱底”衣物列表
 * @param username 用户名
 * @param daysThreshold 天数阈值（超过此天数未使用即视为压箱底）
 * @param minUsage 最低使用次数阈值（低于此次数且超过天数阈值时提醒）
 */
const getUnusedClothes = async (
  username: string,
  daysThreshold: number = 30,
  minUsage: number = 1
): Promise<UnusedClothingItem[]> => {
  try {
    // 1. 获取所有衣物
    const clothesKey = getUserClothesKey(username);
    const clothesRaw = await AsyncStorage.getItem(clothesKey);
    if (!clothesRaw) return [];
    const allClothes: ClothingItem[] = JSON.parse(clothesRaw);
    if (allClothes.length === 0) return [];

    // 2. 获取搭配历史
    const history = await getOutfitHistory(username);
    
    // 3. 统计每件衣物的使用次数和最后使用日期
    const usageMap = new Map<string, { count: number; lastDate: string }>();
    for (const record of history) {
      const recordDate = record.date; // ISO 字符串
      const items = [record.top, record.bottom, record.shoes].filter(Boolean);
      for (const item of items) {
        if (item && item.id) {
          const existing = usageMap.get(item.id);
          if (existing) {
            existing.count++;
            // 更新最后日期（取最近的）
            if (recordDate > existing.lastDate) existing.lastDate = recordDate;
          } else {
            usageMap.set(item.id, { count: 1, lastDate: recordDate });
          }
        }
      }
    }

    // 4. 筛选压箱底衣物
    const now = new Date();
    const thresholdDate = new Date();
    thresholdDate.setDate(now.getDate() - daysThreshold);

    const unused: UnusedClothingItem[] = [];
    for (const clothing of allClothes) {
      const stat = usageMap.get(clothing.id);
      const usageCount = stat ? stat.count : 0;
      const lastUsed = stat ? new Date(stat.lastDate) : null;
      
      // 条件：从未使用 或 使用次数 ≤ minUsage 且最后使用日期早于阈值日期
      const isUnused = !lastUsed || (usageCount <= minUsage && lastUsed < thresholdDate);
      if (isUnused) {
        unused.push({
          ...clothing,
          usageCount,
          lastUsedDate: lastUsed ? lastUsed.toLocaleDateString() : '从未穿过'
        });
      }
    }
    
    // 按使用次数升序、从未使用的排前面
    unused.sort((a, b) => a.usageCount - b.usageCount);
    return unused;
  } catch (error) {
    console.error('获取压箱底衣物失败:', error);
    return [];
  }
};
// ========== 启动页组件 ==========
function SplashView() {
  return (
    <View style={styles.centerContainer}>
      <ActivityIndicator size="large" color="#FF69B4" />
      <Text>加载中...</Text>
    </View>
  );
}

// ========== 登录/注册页组件 ==========
function AuthScreen({ onLoginSuccess }: { onLoginSuccess: (username: string) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');

  const handleSubmit = async () => {
    if (!username || !password) {
      Alert.alert('提示', '请填写用户名和密码');
      return;
    }
    const users = await getUsers();
    if (isLogin) {
      const user = users.find(u => u.username === username && u.password === password);
      if (user) {
        await setCurrentUser(username);
        onLoginSuccess(username);
      } else {
        Alert.alert('错误', '用户名或密码错误');
      }
    } else {
      if (users.find(u => u.username === username)) {
        Alert.alert('错误', '用户名已存在');
        return;
      }
      const newUser: UserInfo = {
        username,
        password,
        nickname: nickname || username,
        createdAt: new Date().toISOString()
      };
      await saveUsers([...users, newUser]);
      await setCurrentUser(username);
      onLoginSuccess(username);
    }
  };

  return (
    <View style={styles.centerContainer}>
      <View style={styles.authCard}>
        <Text style={styles.authTitle}>{isLogin ? '登录' : '注册'}</Text>
        <TextInput
          style={styles.input}
          placeholder="用户名"
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="密码"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {!isLogin && (
          <TextInput
            style={styles.input}
            placeholder="昵称（可选）"
            value={nickname}
            onChangeText={setNickname}
          />
        )}
        <Button title={isLogin ? '登录' : '注册'} onPress={handleSubmit} />
        <TouchableOpacity onPress={() => setIsLogin(!isLogin)} style={{ marginTop: 10 }}>
          <Text style={styles.authSwitch}>
            {isLogin ? '没有账号？去注册' : '已有账号？去登录'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ========== 衣橱页面组件（分区展示） ==========
import { useNavigation } from '@react-navigation/native';
function WardrobeScreen({ username }: { username: string }) {
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [newItem, setNewItem] = useState<Partial<ClothingItem>>({});
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const navigation = useNavigation();
  useEffect(() => {
    loadClothes();
  }, []);

  const loadClothes = async () => {
    try {
      const stored = await AsyncStorage.getItem(getUserClothesKey(username));
      if (stored) setClothes(JSON.parse(stored));
    } catch (error) {
      console.error('加载失败', error);
    }
  };

  const saveClothes = async (newClothes: ClothingItem[]) => {
    try {
      await AsyncStorage.setItem(getUserClothesKey(username), JSON.stringify(newClothes));
      setClothes(newClothes);
    } catch (error) {
      console.error('保存失败', error);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要权限', '请允许访问相册');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0].uri) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要权限', '请允许使用相机');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0].uri) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const addClothing = () => {
    if (!selectedImage) {
      Alert.alert('请选择图片');
      return;
    }
    const newClothing: ClothingItem = {
      id: Date.now().toString(),
      imageUri: selectedImage,
      category: newItem.category || '未分类',
      color: newItem.color || '未知',
      note: newItem.note,
    };
    const updated = [...clothes, newClothing];
    saveClothes(updated);
    setModalVisible(false);
    setSelectedImage(null);
    setNewItem({});
  };

  const deleteItem = (id: string) => {
    Alert.alert('删除', '确定要删除这件衣物吗？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => {
        const filtered = clothes.filter(c => c.id !== id);
        saveClothes(filtered);
      }},
    ]);
  };

  // ---------- 分类逻辑 ----------
  const categorizeClothes = (items: ClothingItem[]) => {
    const sections = [
      { title: '👕 上装', data: [] as ClothingItem[] },
      { title: '👖 下装', data: [] as ClothingItem[] },
      { title: '👟 鞋子', data: [] as ClothingItem[] },
      { title: '📦 其他', data: [] as ClothingItem[] },
    ];

    items.forEach(item => {
      const cat = item.category.toLowerCase();
      // 上装：上衣、T恤、衬衫、毛衣、卫衣、外套、夹克等
      if (cat.includes('上衣') || cat === 't恤' || cat.includes('衬衫') || cat.includes('毛衣') || cat.includes('卫衣') || cat.includes('外套') || cat.includes('夹克')) {
        sections[0].data.push(item);
      }
      // 下装：裤子、牛仔裤、短裤、长裤、半裙、裙子
      else if (cat.includes('裤子') || cat.includes('裙子') || cat.includes('短裤') || cat.includes('长裤')|| cat.includes('下装')) {
        sections[1].data.push(item);
      }
      // 鞋子：鞋、运动鞋、皮鞋、凉鞋
      else if (cat.includes('鞋') || cat.includes('运动鞋') || cat.includes('皮鞋') || cat.includes('凉鞋')) {
        sections[2].data.push(item);
      }
      else {
        sections[3].data.push(item);
      }
    });

    // 过滤掉空分区
    return sections.filter(sec => sec.data.length > 0);
  };

  // 横向渲染单个衣物卡片
  const renderHorizontalItem = ({ item }: { item: ClothingItem }) => (
  <TouchableOpacity
    style={styles.horizontalCard}
    onPress={() => {
      // @ts-ignore
      navigation.navigate('DIY', {
        imageUri: item.imageUri,
        category: item.category,
      });
    }}
    onLongPress={() => deleteItem(item.id)}
    activeOpacity={0.7}
  >
    <Image source={{ uri: item.imageUri }} style={styles.horizontalImage} />
    <Text style={styles.horizontalCategory}>{item.category}</Text>
    <Text style={styles.horizontalColor}>{item.color}</Text>
    {item.note ? <Text style={styles.horizontalNote}>{item.note}</Text> : null}
  </TouchableOpacity>
);
  // 渲染每个分区（标题 + 横向滚动列表）
  const renderSection = ({ item }: { item: { title: string; data: ClothingItem[] } }) => (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>{item.title}</Text>
      <FlatList
        data={item.data}
        renderItem={renderHorizontalItem}
        keyExtractor={(subItem) => subItem.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalList}
      />
    </View>
  );

  const sections = categorizeClothes(clothes);

  return (
    <View style={styles.container}>
      <FlatList
        data={sections}
        renderItem={renderSection}
        keyExtractor={(_, index) => index.toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>暂无衣物，点击➕添加</Text>}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>

      {/* 添加衣物的 Modal（保持不变） */}
      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>添加新衣物</Text>
            {selectedImage ? (
              <Image source={{ uri: selectedImage }} style={styles.previewImage} />
            ) : (
              <View style={styles.imagePlaceholder}><Text>未选择图片</Text></View>
            )}
            <View style={styles.imageButtons}>
              <TouchableOpacity style={styles.imageButton} onPress={pickImage}><Text>📁 相册</Text></TouchableOpacity>
              <TouchableOpacity style={styles.imageButton} onPress={takePhoto}><Text>📷 相机</Text></TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="类别 (如: 上衣, 裤子)"
              value={newItem.category}
              onChangeText={text => setNewItem({...newItem, category: text})}
            />
            <TextInput
              style={styles.input}
              placeholder="颜色 (如: 白色, 蓝色)"
              value={newItem.color}
              onChangeText={text => setNewItem({...newItem, color: text})}
            />
            <TextInput
              style={styles.input}
              placeholder="备注 (可选)"
              value={newItem.note}
              onChangeText={text => setNewItem({...newItem, note: text})}
            />
            <View style={styles.modalButtons}>
              <Button title="取消" onPress={() => { setModalVisible(false); setSelectedImage(null); setNewItem({}); }} />
              <Button title="保存" onPress={addClothing} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ========== 搭配页面组件（完整版，支持滚动） ==========
function OutfitScreen({ username }: { username: string }) {
  const [weather, setWeather] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [aiRecommendation, setAiRecommendation] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [outfit, setOutfit] = useState<{
    top?: ClothingItem;
    bottom?: ClothingItem;
    shoes?: ClothingItem;
  }>({});
  const [allClothes, setAllClothes] = useState<ClothingItem[]>([]);

  // 风格和场景临时选择
  const [selectedStyle, setSelectedStyle] = useState<string>('');
  const [selectedScene, setSelectedScene] = useState<string>('');
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [showScenePicker, setShowScenePicker] = useState(false);

  // 风格/场景选项
  const styleOptions = ['简约', '通勤', '法式', '休闲', '运动', '复古', '甜美', '街头','日系','韩系'];
  const sceneOptions = ['日常', '通勤', '约会', '运动', '旅行', '聚会', '居家'];

  // 获取天气（独立函数）
  const fetchWeather = async (lat: number, lon: number) => {
    try {
      const weatherRes = await axios.get(`${API_BASE_URL}/weather`, {
        params: { lat, lon }
      });
      if (weatherRes.data && !weatherRes.data.error) {
        setWeather(weatherRes.data);
      } else {
        console.warn('天气接口返回错误', weatherRes.data);
      }
    } catch (weatherError) {
      console.error('天气请求失败:', weatherError);
    }
  };

  // 随机搭配生成
  const generateRandomOutfit = (clothes: ClothingItem[]) => {
    const tops = clothes.filter(c => c.category.includes('上衣') || c.category === 'T恤' || c.category === '衬衫');
    const bottoms = clothes.filter(c => c.category.includes('裤子') || c.category.includes('裙子') || c.category === '下装');
    const shoes = clothes.filter(c => c.category.includes('鞋') || c.category === '鞋子');

    const randomItem = (arr: ClothingItem[]) => {
      if (arr.length === 0) return undefined;
      return arr[Math.floor(Math.random() * arr.length)];
    };

    setOutfit({
      top: randomItem(tops),
      bottom: randomItem(bottoms),
      shoes: randomItem(shoes),
    });
  };

  // 加载天气和衣橱数据（固定坐标，避免定位问题）
  const loadWeatherAndClothes = async () => {
    try {
      // 固定使用成都坐标，你也可以改为自己的城市
      const fixedLat = 30.67;
      const fixedLon = 104.06;
      await fetchWeather(fixedLat, fixedLon);

      // 读取衣橱
      const stored = await AsyncStorage.getItem(getUserClothesKey(username));
      if (stored) {
        const clothes: ClothingItem[] = JSON.parse(stored);
        setAllClothes(clothes);
        generateRandomOutfit(clothes);
      } else {
        Alert.alert('提示', '衣橱里还没有衣物，请先去添加');
      }
    } catch (error) {
      console.error('加载失败:', error);
      Alert.alert('加载失败', '请检查网络或后端服务');
    } finally {
      setLoading(false);
    }
  };

  // 刷新随机搭配
  const refreshOutfit = () => {
    if (allClothes.length > 0) {
      generateRandomOutfit(allClothes);
    } else {
      Alert.alert('提示', '衣橱为空，请先添加衣物');
    }
  };

  // AI 推荐函数
  const getAiRecommendation = async () => {
    if (allClothes.length === 0) {
      Alert.alert('提示', '衣橱为空，请先添加衣物');
      return;
    }

    // 读取用户持久化的偏好（体型、颜色偏好等）
    const prefsRaw = await AsyncStorage.getItem(`preferences_${username}`);
    const preferences = prefsRaw ? JSON.parse(prefsRaw) : {};
    console.log('发送给后端的风格:', selectedStyle, '场景:', selectedScene);
    setAiLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/ai-recommend`, {
        weather: weather,
        wardrobe: allClothes.map(item => ({
          category: item.category,
          color: item.color,
          note: item.note || ''
        })),
        query: "请推荐一套适合今天天气和场景的穿搭",
        user_profile: {
          style: selectedStyle || preferences.style || '简约',
          body_shape: preferences.bodyShape || '',
          color_preference: preferences.colorPreference || '',
          special_request: preferences.specialRequest || '',
          scene: selectedScene || preferences.scene || '日常'
        }
      });

      if (response.data.success) {
  setAiRecommendation(response.data.recommendation);
  console.log('AI推荐结果:', response.data.recommendation); // 添加日志
} else {
  Alert.alert('AI推荐失败', response.data.error);
}
    } catch (error) {
      console.error('AI推荐请求失败:', error);
      Alert.alert('网络错误', '无法连接AI服务，请检查后端是否运行');
    } finally {
      setAiLoading(false);
    }
  };

  // 保存搭配（保存当前的随机搭配）
  const handleSaveOutfit = async () => {
  // 检查当前 outfit 是否有内容（无论是随机生成的还是应用AI推荐后产生的）
  if (!outfit.top && !outfit.bottom && !outfit.shoes) {
    Alert.alert('提示', '暂无搭配可保存');
    return;
  }
  
  // 确定搭配类型：如果存在 AI 推荐且用户没有拒绝，可以认为是 AI 建议后的搭配
  // 但为了简单，统一保存为 'custom' 或沿用原有逻辑
  let type = 'random';
  // 如果用户应用过AI推荐（可以增加标志位，但可选），这里简化：有 AI 推荐记录且当前 outfit 不为空就认为是 AI
  if (aiRecommendation && (outfit.top || outfit.bottom || outfit.shoes)) {
    type = 'ai';
  }
  
  const success = await saveOutfitToHistory(username, outfit, type, weather);
  if (success) {
    Alert.alert('成功', '搭配已保存到历史记录');
  } else {
    Alert.alert('失败', '保存失败，请重试');
  }
};

  // ========== AI 推荐匹配到实际衣物的函数 ==========
  const colorKeywords = ['白色', '黑色', '红色','灰绿色','灰银','米白色','橙色','米粉色','蓝棕色','灰米色','黑白','藏蓝色','薄荷绿', '蓝色', '绿色', '黄色', '紫色', '粉色', '灰色', '棕色', '米色', '卡其', '牛仔', '条纹', '格子'];
  const extractColor = (text: string): string => {
    for (const color of colorKeywords) {
      if (text.includes(color)) return color;
    }
    return '';
  };
  const matchClothingItem = (
    recommendationText: string,
    targetCategory: 'top' | 'bottom' | 'shoes',
    wardrobe: ClothingItem[]
  ): ClothingItem | null => {
    let categoryItems: ClothingItem[] = [];
    if (targetCategory === 'top') {
      categoryItems = wardrobe.filter(c => c.category.includes('上衣') || c.category === 'T恤' || c.category === '衬衫' || c.category === '外套');
    } else if (targetCategory === 'bottom') {
      categoryItems = wardrobe.filter(c => c.category.includes('裤子') || c.category.includes('裙子') || c.category === '下装');
    } else {
      categoryItems = wardrobe.filter(c => c.category.includes('鞋') || c.category === '鞋子');
    }
    if (categoryItems.length === 0) return null;
    const targetColor = extractColor(recommendationText);
    if (targetColor) {
      const colorMatch = categoryItems.find(item => item.color.includes(targetColor));
      if (colorMatch) return colorMatch;
    }
    return categoryItems[0];
  };
  const applyAiRecommendation = () => {
    if (!aiRecommendation) {
      Alert.alert('提示', '没有可应用的AI推荐');
      return;
    }
    const { top: topText, bottom: bottomText, shoes: shoesText } = aiRecommendation;
    const matchedTop = matchClothingItem(topText, 'top', allClothes);
    const matchedBottom = matchClothingItem(bottomText, 'bottom', allClothes);
    const matchedShoes = matchClothingItem(shoesText, 'shoes', allClothes);
    if (!matchedTop && !matchedBottom && !matchedShoes) {
      Alert.alert('匹配失败', '衣橱中没有与AI推荐相似的衣物');
      return;
    }
    setOutfit({
      top: matchedTop || undefined,
      bottom: matchedBottom || undefined,
      shoes: matchedShoes || undefined,
    });
    const missing = [];
    if (!matchedTop && topText !== '暂无') missing.push('上衣');
    if (!matchedBottom && bottomText !== '暂无') missing.push('下装');
    if (!matchedShoes && shoesText !== '暂无') missing.push('鞋子');
    if (missing.length > 0) {
      Alert.alert('部分匹配成功', `未找到匹配的${missing.join('、')}，请手动选择`);
    } else {
      Alert.alert('成功', '已应用AI推荐的搭配');
    }
  };

// 虚拟试穿状态
const [showTryonModal, setShowTryonModal] = useState(false);
const [personImage, setPersonImage] = useState<string | null>(null);
const [clothingImage, setClothingImage] = useState<string | null>(null);
const [tryonLoading, setTryonLoading] = useState(false);
const [tryonResult, setTryonResult] = useState<string | null>(null);

// 批量试穿相关状态
const [showMultiPicker, setShowMultiPicker] = useState(false);
const [wardrobeItems, setWardrobeItems] = useState<ClothingItem[]>([]);
const [selectedTop, setSelectedTop] = useState<ClothingItem | null>(null);
const [selectedBottom, setSelectedBottom] = useState<ClothingItem | null>(null);

// 加载衣橱数据（用于多选）
const loadWardrobeForTryon = async () => {
  const stored = await AsyncStorage.getItem(getUserClothesKey(username));
  if (stored) setWardrobeItems(JSON.parse(stored));
};

// 执行试穿（支持单件或多件）
const performTryOn = async (topUri: string, bottomUri?: string) => {
  if (!personImage) {
    Alert.alert('提示', '请先选择全身照');
    return;
  }
  setTryonLoading(true);
  const formData = new FormData();
  formData.append('person_image', {
    uri: personImage,
    name: 'person.jpg',
    type: 'image/jpeg',
  } as any);
  formData.append('top_image', {
    uri: topUri,
    name: 'top.jpg',
    type: 'image/jpeg',
  } as any);
  if (bottomUri) {
    formData.append('bottom_image', {
      uri: bottomUri,
      name: 'bottom.jpg',
      type: 'image/jpeg',
    } as any);
  }
  try {
    const response = await axios.post(`${API_BASE_URL}/tryon/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    if (response.data.success) {
      setTryonResult(response.data.image_url);
      Alert.alert('成功', '试穿效果已生成！');
    } else {
      Alert.alert('失败', response.data.error || '生成失败');
    }
  } catch (error) {
    console.error('试穿请求失败', error);
    Alert.alert('网络错误', '无法连接服务器');
  } finally {
    setTryonLoading(false);
  }
};

// 选择全身照
const pickPersonImage = async () => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('需要权限', '请允许访问相册');
    return;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.8,
  });
  if (!result.canceled && result.assets[0].uri) {
    setPersonImage(result.assets[0].uri);
  }
};

// 选择衣物图片（从相册）
const pickClothingImage = async () => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('需要权限', '请允许访问相册');
    return;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.8,
  });
  if (!result.canceled && result.assets[0].uri) {
    setClothingImage(result.assets[0].uri);
  }
};

// 保存到相册
const saveToAlbum = async () => {
  if (!tryonResult) return;
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('需要权限', '请允许保存图片到相册');
    return;
  }
  try {
    const asset = await MediaLibrary.createAssetAsync(tryonResult);
    await MediaLibrary.createAlbumAsync('魔镜试穿', asset, false);
    Alert.alert('成功', '已保存到相册“魔镜试穿”');
  } catch (error) {
    Alert.alert('保存失败', '请重试');
  }
};

// 触发批量试穿的主函数（用于多选模态框中的“开始试穿”）
const handleMultiTryOn = async () => {
  if (!selectedTop) {
    Alert.alert("请选择上衣");
    return;
  }
  await performTryOn(selectedTop.imageUri, selectedBottom?.imageUri);
  setShowMultiPicker(false);
};

  // 保存为默认偏好
  const saveAsDefault = async () => {
    try {
      const prefsRaw = await AsyncStorage.getItem(`preferences_${username}`);
      const preferences = prefsRaw ? JSON.parse(prefsRaw) : {};
      preferences.style = selectedStyle;
      preferences.scene = selectedScene;
      await AsyncStorage.setItem(`preferences_${username}`, JSON.stringify(preferences));
      Alert.alert('成功', '已保存为默认偏好');
    } catch (error) {
      console.error('保存失败', error);
    }
  };

  // 加载用户偏好作为初始值
  useEffect(() => {
    const loadPreferences = async () => {
      const prefsRaw = await AsyncStorage.getItem(`preferences_${username}`);
      const preferences = prefsRaw ? JSON.parse(prefsRaw) : {};
      setSelectedStyle(preferences.style || '简约');
      setSelectedScene(preferences.scene || '日常');
    };
    loadPreferences();
    loadWeatherAndClothes();
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF69B4" />
        <Text>加载中...</Text>
      </View>
    );
  }

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={true}
    >
      {weather && (
        <View style={styles.weatherCard}>
          <Text style={styles.temp}>{Math.round(weather.temp)}°C</Text>
          <Text style={styles.desc}>{weather.description}</Text>
          <Text style={styles.advice}>✨ {weather.advice}</Text>
        </View>
      )}

      {/* 风格和场景选择器 */}
      <View style={styles.selectorContainer}>
        <TouchableOpacity style={styles.selectorButton} onPress={() => setShowStylePicker(true)}>
          <Text style={styles.selectorLabel}>风格：</Text>
          <Text style={styles.selectorValue}>{selectedStyle}</Text>
          <Ionicons name="chevron-down-outline" size={16} color="#666" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.selectorButton} onPress={() => setShowScenePicker(true)}>
          <Text style={styles.selectorLabel}>场景：</Text>
          <Text style={styles.selectorValue}>{selectedScene}</Text>
          <Ionicons name="chevron-down-outline" size={16} color="#666" />
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.saveDefaultButton} onPress={saveAsDefault}>
        <Text style={styles.saveDefaultText}>💾 保存为默认偏好</Text>
      </TouchableOpacity>

      <View style={styles.outfitCard}>
        <Text style={styles.outfitTitle}>今日推荐搭配</Text>
        <View style={styles.outfitRow}>
          <View style={styles.outfitItem}>
            <Text style={styles.itemLabel}>👕 上衣</Text>
            {outfit.top ? (
              <Image source={{ uri: outfit.top.imageUri }} style={styles.outfitImage} />
            ) : (
              <View style={styles.placeholder}><Text>暂无上衣</Text></View>
            )}
          </View>
          <View style={styles.outfitItem}>
            <Text style={styles.itemLabel}>👖 下装</Text>
            {outfit.bottom ? (
              <Image source={{ uri: outfit.bottom.imageUri }} style={styles.outfitImage} />
            ) : (
              <View style={styles.placeholder}><Text>暂无下装</Text></View>
            )}
          </View>
          <View style={styles.outfitItem}>
            <Text style={styles.itemLabel}>👟 鞋子</Text>
            {outfit.shoes ? (
              <Image source={{ uri: outfit.shoes.imageUri }} style={styles.outfitImage} />
            ) : (
              <View style={styles.placeholder}><Text>暂无鞋子</Text></View>
            )}
          </View>
        </View>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.refreshButton} onPress={refreshOutfit}>
            <Text style={styles.refreshText}>换一套 🔄</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.aiButton} onPress={getAiRecommendation}>
            <Text style={styles.aiButtonText}>✨ AI智能推荐</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveButton} onPress={handleSaveOutfit}>
            <Text style={styles.saveButtonText}>💾 保存搭配</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.tryonButton} onPress={() => setShowTryonModal(true)}>
            <Text style={styles.tryonButtonText}>👗 虚拟试穿</Text>
           </TouchableOpacity>
        {aiLoading && (
          <View style={styles.aiResult}>
            <ActivityIndicator size="small" color="#FF69B4" />
            <Text style={styles.aiLoadingText}>AI正在思考搭配方案...</Text>
          </View>
        )}
        {aiRecommendation && !aiLoading && (
          <View style={styles.aiResult}>
            <Text style={styles.aiResultTitle}>🤖 AI造型师建议</Text>
            <Text style={styles.aiResultText}>上衣：{aiRecommendation.top}</Text>
            <Text style={styles.aiResultText}>下装：{aiRecommendation.bottom}</Text>
            <Text style={styles.aiResultText}>鞋子：{aiRecommendation.shoes}</Text>
            <Text style={styles.aiReason}>💡 {aiRecommendation.reason}</Text>
            {aiRecommendation.style_tips && (
              <Text style={styles.aiTips}>✨ {aiRecommendation.style_tips}</Text>
            )}
            <TouchableOpacity style={styles.applyButton} onPress={applyAiRecommendation}>
              <Text style={styles.applyButtonText}>👕 应用此搭配</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 底部留白 */}
      <View style={{ height: 30 }} />

      {/* 风格选择弹窗 */}
      <Modal visible={showStylePicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.pickerModal}>
            <Text style={styles.pickerTitle}>选择风格</Text>
            <FlatList
              data={styleOptions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerItem}
                  onPress={() => {
                    setSelectedStyle(item);
                    setShowStylePicker(false);
                  }}
                >
                  <Text style={styles.pickerItemText}>{item}</Text>
                </TouchableOpacity>
              )}
            />
            <Button title="取消" onPress={() => setShowStylePicker(false)} />
          </View>
        </View>
      </Modal>

      {/* 场景选择弹窗 */}
      <Modal visible={showScenePicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.pickerModal}>
            <Text style={styles.pickerTitle}>选择场景</Text>
            <FlatList
              data={sceneOptions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerItem}
                  onPress={() => {
                    setSelectedScene(item);
                    setShowScenePicker(false);
                  }}
                >
                  <Text style={styles.pickerItemText}>{item}</Text>
                </TouchableOpacity>
              )}
            />
            <Button title="取消" onPress={() => setShowScenePicker(false)} />
          </View>
        </View>
      </Modal>
      {/* 虚拟试穿模态框（支持滚动） */}
<Modal visible={showTryonModal} animationType="slide" transparent={true}>
  <View style={styles.modalContainer}>
    <ScrollView
      style={styles.modalContent}
      contentContainerStyle={styles.modalScrollContent}
      showsVerticalScrollIndicator={true}
    >
      <Text style={styles.modalTitle}>虚拟试穿</Text>

      {/* 选择全身照 */}
      <TouchableOpacity style={styles.imagePicker} onPress={pickPersonImage}>
        {personImage ? (
          <Image source={{ uri: personImage }} style={styles.previewImageSmall} />
        ) : (
          <Text>选择全身照</Text>
        )}
      </TouchableOpacity>

      

      {/* 从衣橱选择多件搭配 */}
      <TouchableOpacity
        style={styles.imagePicker}
        onPress={() => {
          loadWardrobeForTryon();
          setShowMultiPicker(true);
        }}
      >
        <Text>👚 从衣橱选择多件搭配</Text>
      </TouchableOpacity>

      {/* 按钮行 */}
      <View style={styles.modalButtons}>
        <Button title="开始试穿" onPress={handleMultiTryOn} disabled={tryonLoading} />
        <Button
          title="关闭"
          onPress={() => {
            setShowTryonModal(false);
            setPersonImage(null);
            setClothingImage(null);
            setTryonResult(null);
          }}
        />
      </View>

      {tryonLoading && <ActivityIndicator size="large" color="#FF69B4" />}

      {tryonResult && (
        <View style={styles.resultContainer}>
          <Image source={{ uri: tryonResult }} style={styles.resultImage} />
          <Button title="保存到相册" onPress={saveToAlbum} />
        </View>
      )}
    </ScrollView>
  </View>
</Modal>
       {/* 多选衣橱模态框（平级，不要嵌套在其他 Modal 或 ScrollView 内部） */}
<Modal visible={showMultiPicker} animationType="slide" transparent>
  <View style={styles.modalContainer}>
    <View style={styles.modalContent}>
      <Text style={styles.modalTitle}>选择搭配衣物</Text>

      {/* 上衣选择 */}
      <Text style={styles.sectionTitle}>👕 上衣（必选）</Text>
      <FlatList
        data={wardrobeItems.filter(item => 
          item.category.includes('上衣') || item.category === 'T恤' || item.category === '衬衫'
        )}
        horizontal
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.wardrobeItem, selectedTop?.id === item.id && styles.selectedItem]}
            onPress={() => setSelectedTop(item)}
          >
            <Image source={{ uri: item.imageUri }} style={styles.wardrobeImage} />
            <Text style={styles.wardrobeLabel}>{item.category}</Text>
          </TouchableOpacity>
        )}
        keyExtractor={item => item.id}
        ListEmptyComponent={<Text>暂无上衣</Text>}
      />

      {/* 下装选择 */}
      <Text style={styles.sectionTitle}>👖 下装（可选）</Text>
      <FlatList
        data={wardrobeItems.filter(item => 
          item.category.includes('裤子') || item.category.includes('裙子')
        )}
        horizontal
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.wardrobeItem, selectedBottom?.id === item.id && styles.selectedItem]}
            onPress={() => setSelectedBottom(item)}
          >
            <Image source={{ uri: item.imageUri }} style={styles.wardrobeImage} />
            <Text style={styles.wardrobeLabel}>{item.category}</Text>
          </TouchableOpacity>
        )}
        keyExtractor={item => item.id}
        ListEmptyComponent={<Text>暂无下装</Text>}
      />

      <View style={styles.modalButtons}>
        <Button title="取消" onPress={() => {
          setShowMultiPicker(false);
          setSelectedTop(null);
          setSelectedBottom(null);
        }} />
        <Button
          title="开始试穿"
          onPress={async () => {
            if (!selectedTop) {
              Alert.alert("请选择上衣");
              return;
            }
            await performTryOn(selectedTop.imageUri, selectedBottom?.imageUri);
            setShowMultiPicker(false);
          }}
        />
      </View>
    </View>
  </View>
</Modal>
    </ScrollView>
  );
}
// ========== 我的页面组件（可滚动） ==========
function ProfileScreen({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [clothesCount, setClothesCount] = useState(0);
  const [preferences, setPreferences] = useState({
    style: '',
    bodyShape: '',
    colorPreference: '',
    specialRequest: '',
    scene: '',
  });
  const [showPrefModal, setShowPrefModal] = useState(false);
  const [unusedClothes, setUnusedClothes] = useState<UnusedClothingItem[]>([]);
  const [loadingUnused, setLoadingUnused] = useState(false);

  useEffect(() => {
    loadProfile();
    loadPreferences();
    loadUnusedClothes();
  }, []);

  const loadProfile = async () => {
    const users = await getUsers();
    setUserInfo(users.find(u => u.username === username) || null);
    const stored = await AsyncStorage.getItem(getUserClothesKey(username));
    if (stored) setClothesCount(JSON.parse(stored).length);
  };

  const loadPreferences = async () => {
    const prefs = await AsyncStorage.getItem(`preferences_${username}`);
    if (prefs) setPreferences(JSON.parse(prefs));
  };

  const loadUnusedClothes = async () => {
    setLoadingUnused(true);
    const unused = await getUnusedClothes(username, 30, 1);
    setUnusedClothes(unused);
    setLoadingUnused(false);
  };

  const savePreferences = async () => {
    await AsyncStorage.setItem(`preferences_${username}`, JSON.stringify(preferences));
    Alert.alert('成功', '偏好设置已保存');
    setShowPrefModal(false);
  };

  const handleLogout = () => {
    Alert.alert('退出登录', '确定要退出当前账号吗？', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: async () => {
        await clearCurrentUser();
        onLogout();
      }},
    ]);
  };

  const onClothingPress = (item: UnusedClothingItem) => {
    Alert.alert(
      '压箱底提醒',
      `${item.category}（${item.color}）\n上次使用：${item.lastUsedDate}\n使用次数：${item.usageCount} 次\n\n快去穿它出门吧！`
    );
  };

  return (
    <ScrollView 
      style={styles.profileContainer}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={true}
    >
      <View style={styles.centerContainer}>
        <View style={styles.profileCard}>
          <Ionicons name="person-circle" size={80} color="#FF69B4" />
          <Text style={styles.profileNickname}>{userInfo?.nickname || username}</Text>
          <Text style={styles.profileUsername}>@{username}</Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{clothesCount}</Text>
              <Text style={styles.statLabel}>衣物</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>0</Text>
              <Text style={styles.statLabel}>搭配</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.prefButton} onPress={() => setShowPrefModal(true)}>
            <Text style={styles.prefButtonText}>🎨 穿搭偏好设置</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutText}>退出登录</Text>
          </TouchableOpacity>
        </View>

        {/* 压箱底衣物区块 */}
        <View style={styles.unusedSection}>
          <Text style={styles.unusedTitle}>📦 压箱底衣物提醒</Text>
          {loadingUnused ? (
            <ActivityIndicator size="small" color="#FF69B4" />
          ) : unusedClothes.length === 0 ? (
            <Text style={styles.unusedEmpty}>太棒了！没有压箱底的衣物 👏</Text>
          ) : (
            <FlatList
              data={unusedClothes}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.unusedItem} onPress={() => onClothingPress(item)}>
                  <Image source={{ uri: item.imageUri }} style={styles.unusedImage} />
                  <Text style={styles.unusedItemCategory}>{item.category}</Text>
                  <Text style={styles.unusedItemColor}>{item.color}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text>暂无数据</Text>}
            />
          )}
        </View>

        {/* 偏好设置模态框 */}
        <Modal visible={showPrefModal} animationType="slide" transparent>
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>穿搭偏好</Text>
              <TextInput
                style={styles.input}
                placeholder="风格（如：简约、通勤、法式）"
                value={preferences.style}
                onChangeText={text => setPreferences({...preferences, style: text})}
              />
              <TextInput
                style={styles.input}
                placeholder="体型（如：梨形、苹果型、沙漏）"
                value={preferences.bodyShape}
                onChangeText={text => setPreferences({...preferences, bodyShape: text})}
              />
              <TextInput
                style={styles.input}
                placeholder="颜色偏好（如：浅色、莫兰迪色）"
                value={preferences.colorPreference}
                onChangeText={text => setPreferences({...preferences, colorPreference: text})}
              />
              <TextInput
                style={styles.input}
                placeholder="特殊要求（如：显腿长、遮小腹）"
                value={preferences.specialRequest}
                onChangeText={text => setPreferences({...preferences, specialRequest: text})}
              />
              <TextInput
                style={styles.input}
                placeholder="常见场景（如：通勤、约会、运动、旅行）"
                value={preferences.scene}
                onChangeText={text => setPreferences({...preferences, scene: text})}
              />
              <View style={styles.modalButtons}>
                <Button title="取消" onPress={() => setShowPrefModal(false)} />
                <Button title="保存" onPress={savePreferences} />
              </View>
            </View>
          </View>
        </Modal>
      </View>
      {/* 底部留出一些空白，避免内容贴底 */}
      <View style={{ height: 10 }} />
    </ScrollView>
  );
}
// ========== 搭配历史页面 ==========
function HistoryScreen({ username }: { username: string }) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const data = await getOutfitHistory(username);
    setHistory(data);
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    Alert.alert('删除', '确定要删除这条搭配记录吗？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        await deleteOutfitFromHistory(username, id);
        loadHistory();
      }},
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF69B4" />
        <Text>加载中...</Text>
      </View>
    );
  }

  if (history.length === 0) {
    return (
      <View style={styles.center}>
        <Text>暂无保存的搭配</Text>
        <Text style={{ marginTop: 10 }}>在搭配页面点击“保存搭配”即可记录</Text>
      </View>
    );
  }

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.historyCard}>
      <Text style={styles.historyDate}>{new Date(item.date).toLocaleString()}</Text>
      <View style={styles.outfitRow}>
        <View style={styles.outfitItem}>
          <Text>👕</Text>
          {item.top ? (
            <Image source={{ uri: item.top.imageUri }} style={styles.historyImage} />
          ) : (
            <Text>无</Text>
          )}
        </View>
        <View style={styles.outfitItem}>
          <Text>👖</Text>
          {item.bottom ? (
            <Image source={{ uri: item.bottom.imageUri }} style={styles.historyImage} />
          ) : (
            <Text>无</Text>
          )}
        </View>
        <View style={styles.outfitItem}>
          <Text>👟</Text>
          {item.shoes ? (
            <Image source={{ uri: item.shoes.imageUri }} style={styles.historyImage} />
          ) : (
            <Text>无</Text>
          )}
        </View>
      </View>
      {item.weather && (
        <Text style={styles.historyWeather}>天气：{item.weather.temp}°C {item.weather.description}</Text>
      )}
      <TouchableOpacity style={styles.deleteButton} onPress={() => handleDelete(item.id)}>
        <Text style={styles.deleteButtonText}>删除记录</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
      <FlatList
        data={history}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator={true}
      />
    </View>
  );
}
// ========== 主应用组件 ==========
export default function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await getCurrentUser();
      if (saved) setCurrentUser(saved);
      setAuthChecked(true);
    })();
  }, []);

  if (!authChecked) return <SplashView />;
  if (!currentUser) {
    return <AuthScreen onLoginSuccess={(uname) => setCurrentUser(uname)} />;
  }

  return (
    <NavigationContainer>
      <BottomTab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#FF69B4',
          tabBarInactiveTintColor: '#8E8E93',
        }}
      >
        <BottomTab.Screen
          name="Wardrobe"
          options={{
            title: '衣橱',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="shirt-outline" size={size} color={color} />
            ),
          }}
        >
          {(props) => <WardrobeScreen {...props} username={currentUser} />}
        </BottomTab.Screen>

        <BottomTab.Screen
          name="Outfit"
          options={{
            title: '搭配',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="sparkles-outline" size={size} color={color} />
            ),
          }}
        >
          {(props) => <OutfitScreen {...props} username={currentUser} />}
        </BottomTab.Screen>
        <BottomTab.Screen
          name="DIY"
          options={{
             title: 'DIY穿搭',
             tabBarIcon: ({ color, size }) => (
               <Ionicons name="brush-outline" size={size} color={color} />
             ),
          }}
>
          {(props) => <DIYCanvas {...props} username={currentUser} />}
        </BottomTab.Screen>
        <BottomTab.Screen
          name="Profile"
          options={{
            title: '我的',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-outline" size={size} color={color} />
            ),
          }}
        >
          {(props) => <ProfileScreen {...props} username={currentUser} onLogout={() => setCurrentUser(null)} />}
        </BottomTab.Screen>

        <BottomTab.Screen
          name="History"
          options={{
             title: '历史',
             tabBarIcon: ({ color, size }) => (
               <Ionicons name="time-outline" size={size} color={color} />
             ),
          }}
>
         {(props) => <HistoryScreen {...props} username={currentUser} />}
         </BottomTab.Screen>
      </BottomTab.Navigator>
    </NavigationContainer>
  );
}
// ========== 主题颜色（莫兰迪色系） ==========
const COLORS = {
  primary: '#D4A5A5',      // 主色：灰粉
  secondary: '#9E9EAC',    // 辅助色：灰紫
  success: '#8FBC8F',      // 成功/保存：鼠尾草绿
  danger: '#C69C8C',       // 删除/警告：陶土红
  background: '#F5F0EB',   // 全局背景
  card: '#FFFFFF',         // 卡片背景
  textPrimary: '#4A4A4A',  // 主要文字
  textSecondary: '#9A9A9A',// 次要文字
  border: '#E8E0D5',       // 边框色
  white: '#FFFFFF',
  black: '#333333',
};
// ========== 样式 ==========
const styles = StyleSheet.create({
  prefButton: {
    backgroundColor: COLORS.secondary,      // '#9b59b6' → secondary
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 30,
    marginTop: 15,
    width: '80%',
    alignItems: 'center',
  },
  prefButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,     // '#f5f5f5' → background
  },
  authCard: {
    width: '80%',
    padding: 20,
    backgroundColor: COLORS.card,
    borderRadius: 20,
    elevation: 3,
  },
  authTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: COLORS.textPrimary,
  },
  authSwitch: {
    textAlign: 'center',
    color: COLORS.primary,                 // '#FF69B4' → primary
    marginTop: 10,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  list: { padding: 8 },
  card: {
    flex: 1,
    margin: 8,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: COLORS.border,
    shadowOpacity: 0.08,
  },
  image: { width: '100%', height: 180, resizeMode: 'cover' },
  info: { padding: 8 },
  category: { fontWeight: 'bold', fontSize: 14, color: COLORS.textPrimary },
  color: { fontSize: 12, color: COLORS.textSecondary },
  note: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 50, color: COLORS.textSecondary },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: COLORS.primary,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  historyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    elevation: 2,
    borderColor: COLORS.border,
    borderWidth: 0.5,
  },
  historyDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  historyImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginTop: 4,
  },
  historyWeather: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  deleteButton: {
    marginTop: 10,
    backgroundColor: COLORS.danger,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: COLORS.white,
    fontSize: 12,
  },
  saveButton: {
    backgroundColor: COLORS.success,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    flex: 1,
    alignItems: 'center',
  },
  saveButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  applyButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 30,
    marginTop: 12,
    alignItems: 'center',
  },
  applyButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalScrollContent: {
  paddingBottom: 40,
  },
  resultContainer: {
  alignItems: 'center',
  marginTop: 10,
  },
  resultImage: {
  width: '100%',
  height: 400,
  resizeMode: 'contain',
  marginBottom: 10,
  },
  profileContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  unusedSection: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    marginTop: 16,
    marginHorizontal: 16,
    marginBottom: 8,  
    padding: 16,
    elevation: 2,
    minHeight: 140,
  },
  unusedEmpty: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    paddingVertical: 20,
  },
  unusedItem: {
    alignItems: 'center',
    marginRight: 16,
    width: 100,
  },
  unusedImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  unusedItemCategory: {
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 6,
    textAlign: 'center',
    color: COLORS.textPrimary,
  },
  unusedItemColor: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  unusedTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: COLORS.textPrimary,
  },
  selectorContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
  },
  selectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    elevation: 2,
  },
  selectorLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  selectorValue: {
    fontSize: 14,
    fontWeight: 'bold',
    marginHorizontal: 4,
    color: COLORS.primary,
  },
  saveDefaultButton: {
    backgroundColor: COLORS.border,
    paddingVertical: 6,
    marginHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
    marginBottom: 8,
  },
  saveDefaultText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  pickerModal: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
    color: COLORS.textPrimary,
  },
  pickerItem: {
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  pickerItemText: {
    fontSize: 16,
    textAlign: 'center',
    color: COLORS.textPrimary,
  },
  scrollContent: {
    paddingBottom: 10,
  },
  tryonButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    marginTop: 10,
    alignItems: 'center',
  },
  tryonButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  imagePicker: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 10,
    marginVertical: 8,
    alignItems: 'center',
    minHeight: 100,
    justifyContent: 'center',
  },
  previewImageSmall: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
 
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
    color: COLORS.textPrimary,
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    marginBottom: 10,
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    width: '100%',
    height: 150,
    backgroundColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    borderRadius: 10,
  },
  imageButtons: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 15 },
  imageButton: {
    backgroundColor: COLORS.border,
    padding: 10,
    borderRadius: 8,
    width: '40%',
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  sectionContainer: {
  marginBottom: 16,
},

horizontalList: {
  paddingHorizontal: 8,
},
horizontalCard: {
  width: 120,
  marginHorizontal: 6,
  backgroundColor: COLORS.card,
  borderRadius: 12,
  overflow: 'hidden',
  alignItems: 'center',
  elevation: 2,
  paddingBottom: 8,
  shadowColor: COLORS.border,
  shadowOpacity: 0.1,
  shadowRadius: 2,
},
horizontalImage: {
  width: 120,
  height: 120,
  resizeMode: 'cover',
},
horizontalCategory: {
  fontSize: 12,
  fontWeight: 'bold',
  marginTop: 4,
  color: COLORS.textPrimary,
},
horizontalColor: {
  fontSize: 10,
  color: COLORS.textSecondary,
},
horizontalNote: {
  fontSize: 10,
  color: COLORS.textSecondary,
  marginTop: 2,
},
  modalButtons: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10 },
  advice: {
    fontSize: 16,
    marginTop: 15,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  outfitCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  outfitTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    color: COLORS.textPrimary,
  },
  outfitRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginBottom: 20 },
  outfitItem: { alignItems: 'center', flex: 1 },
  itemLabel: { fontWeight: 'bold', marginBottom: 8, color: COLORS.textPrimary },
  placeholder: {
    width: 100,
    height: 100,
    backgroundColor: COLORS.border,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 30,
    marginTop: 10,
  },
  refreshText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  weatherCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    elevation: 3,
  },
  temp: { fontSize: 48, fontWeight: 'bold', color: COLORS.primary },
  desc: { fontSize: 18, color: COLORS.textSecondary, marginTop: 5 },
  outfitImage: {
    width: 100,
    height: 100,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 10, gap: 15 },
  aiButton: {
    backgroundColor: COLORS.secondary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    flex: 1,
    alignItems: 'center',
  },
  aiButtonText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },
  aiResult: {
    marginTop: 20,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    width: '100%',
  },
  sectionTitle: {
  fontSize: 16,
  fontWeight: 'bold',
  marginTop: 12,
  marginBottom: 8,
  color: COLORS.textPrimary,
},
wardrobeItem: {
  margin: 6,
  padding: 8,
  alignItems: 'center',
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 12,
  backgroundColor: COLORS.card,
},
selectedItem: {
  borderColor: COLORS.primary,
  borderWidth: 2,
},
wardrobeImage: {
  width: 70,
  height: 70,
  borderRadius: 8,
},
wardrobeLabel: {
  marginTop: 6,
  fontSize: 12,
  color: COLORS.textPrimary,
},
  aiResultTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.primary, marginBottom: 10 },
  aiResultText: { fontSize: 14, color: COLORS.textPrimary, marginBottom: 4 },
  aiReason: { fontSize: 14, color: COLORS.textSecondary, marginTop: 8, fontStyle: 'italic' },
  aiTips: { fontSize: 14, color: COLORS.primary, marginTop: 6 },
  aiLoadingText: { textAlign: 'center', marginTop: 10, color: COLORS.textSecondary },
  profileCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 25,
    alignItems: 'center',
    width: '85%',
    elevation: 3,
  },
  profileNickname: { fontSize: 22, fontWeight: 'bold', marginTop: 10, color: COLORS.textPrimary },
  profileUsername: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 20 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginVertical: 20 },
  statItem: { alignItems: 'center' },
  statNumber: { fontSize: 24, fontWeight: 'bold', color: COLORS.primary },
  statLabel: { fontSize: 14, color: COLORS.textSecondary },
  logoutButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 30,
    borderRadius: 30,
    marginTop: 10,
  },
  logoutText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },
});