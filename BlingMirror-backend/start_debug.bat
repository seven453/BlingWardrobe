@echo off
echo 请确保手机已连接并开启 USB 调试
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8000 tcp:8000
cd /d C:\Users\seven\Desktop\BlingMirror
npx expo start --localhost --android
pause