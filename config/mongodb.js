/**
 * MongoDB 連線配置
 * 北斗教育 - 混合式架構
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 
  'mongodb+srv://sanhsing_db_user:Wra05014a4237@beidou.5hfssts.mongodb.net/beidou?retryWrites=true&w=majority';

let isConnected = false;

async function connectMongoDB() {
  if (isConnected) {
    console.log('📦 MongoDB 已連線');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    isConnected = true;
    console.log('✅ MongoDB Atlas 連線成功');
    
    // 連線事件監聽
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB 連線錯誤:', err);
      isConnected = false;
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB 斷線');
      isConnected = false;
    });
    
  } catch (error) {
    console.error('❌ MongoDB 連線失敗:', error.message);
    // 不拋出錯誤，允許系統在無 MongoDB 時繼續運作（題庫功能）
  }
}

function getConnectionStatus() {
  return {
    connected: isConnected,
    readyState: mongoose.connection.readyState,
    // 0: disconnected, 1: connected, 2: connecting, 3: disconnecting
  };
}

module.exports = { connectMongoDB, getConnectionStatus };
