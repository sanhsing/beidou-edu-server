/**
 * ECPay 綠界金流服務
 * 北斗教育 × 織明
 * 
 * 支援：
 * - 沙箱/正式環境自動切換
 * - 訂閱付款、證照購買
 * - CheckMacValue 簽章驗證
 */

const crypto = require('crypto');

class ECPayService {
  constructor() {
    // 環境判斷
    this.isProduction = process.env.NODE_ENV === 'production';
    
    // 沙箱環境 (測試用)
    this.sandbox = {
      merchantId: '3002607',
      hashKey: 'pwFHCqoQZGmho4w6',
      hashIV: 'EkRm7iFT261dpevs',
      apiUrl: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
    };
    
    // 正式環境 (從環境變數讀取)
    this.production = {
      merchantId: process.env.ECPAY_MERCHANT_ID || '',
      hashKey: process.env.ECPAY_HASH_KEY || '',
      hashIV: process.env.ECPAY_HASH_IV || '',
      apiUrl: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'
    };
    
    // 當前使用的配置
    this.config = this.isProduction ? this.production : this.sandbox;
    
    // 回調網址
    this.returnUrl = process.env.ECPAY_RETURN_URL || 'https://beidou-edu.onrender.com/payment-result';
    this.notifyUrl = process.env.ECPAY_NOTIFY_URL || 'https://beidou-edu.onrender.com/api/payment/callback';
    
    // 訂閱方案價格 (Landing v8.0)
    this.plans = {
      standard: {
        name: '標準版',
        monthly: 299,
        yearly: 2990
      },
      pro: {
        name: '進階版',
        monthly: 499,
        yearly: 1990
      }
    };
    
    // 證照價格
    this.certPrices = {
      'google-ai': { name: 'Google AI 認證', price: 199 },
      'aws-ai': { name: 'AWS AI 認證', price: 299 },
      'azure-ai': { name: 'Azure AI 認證', price: 299 },
      'ipas-security': { name: 'iPAS 資安認證', price: 149 }
    };
  }
  
  /**
   * 產生交易編號
   */
  generateTradeNo() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `BD${timestamp}${random}`.substring(0, 20);
  }
  
  /**
   * 計算 CheckMacValue
   */
  generateCheckMacValue(params) {
    // 1. 依參數名稱排序
    const sortedKeys = Object.keys(params).sort();
    
    // 2. 組合成 query string
    let queryString = `HashKey=${this.config.hashKey}`;
    sortedKeys.forEach(key => {
      queryString += `&${key}=${params[key]}`;
    });
    queryString += `&HashIV=${this.config.hashIV}`;
    
    // 3. URL encode
    queryString = encodeURIComponent(queryString).toLowerCase();
    
    // 4. 特殊字元轉換 (ECPay 規範)
    queryString = queryString
      .replace(/%2d/g, '-')
      .replace(/%5f/g, '_')
      .replace(/%2e/g, '.')
      .replace(/%21/g, '!')
      .replace(/%2a/g, '*')
      .replace(/%28/g, '(')
      .replace(/%29/g, ')')
      .replace(/%20/g, '+');
    
    // 5. SHA256 雜湊
    const hash = crypto.createHash('sha256').update(queryString).digest('hex');
    
    return hash.toUpperCase();
  }
  
  /**
   * 建立訂閱付款
   */
  createSubscriptionPayment({ userId, plan, billingCycle = 'monthly', promoCode = null }) {
    if (!this.plans[plan]) {
      throw new Error(`無效的訂閱方案: ${plan}`);
    }
    
    const planInfo = this.plans[plan];
    let amount = billingCycle === 'yearly' ? planInfo.yearly : planInfo.monthly;
    
    // 優惠碼處理
    if (promoCode === 'LAUNCH20') {
      amount = Math.floor(amount * 0.8); // 8折
    } else if (promoCode === 'FIRST50') {
      amount = Math.floor(amount * 0.5); // 5折
    }
    
    const tradeNo = this.generateTradeNo();
    const tradeDate = this.formatDate(new Date());
    
    const params = {
      MerchantID: this.config.merchantId,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: tradeDate,
      PaymentType: 'aio',
      TotalAmount: amount,
      TradeDesc: encodeURIComponent(`北斗教育${planInfo.name}訂閱`),
      ItemName: `北斗教育${planInfo.name} - ${billingCycle === 'yearly' ? '年繳' : '月繳'}`,
      ReturnURL: this.notifyUrl,
      ClientBackURL: this.returnUrl,
      ChoosePayment: 'Credit',
      EncryptType: 1,
      CustomField1: userId,
      CustomField2: plan,
      CustomField3: billingCycle
    };
    
    params.CheckMacValue = this.generateCheckMacValue(params);
    
    return {
      url: this.config.apiUrl,
      params,
      tradeNo,
      amount,
      isProduction: this.isProduction
    };
  }
  
  /**
   * 建立證照購買付款
   */
  createCertPayment({ userId, certId, isPro = false }) {
    const certInfo = this.certPrices[certId];
    if (!certInfo) {
      throw new Error(`無效的證照: ${certId}`);
    }
    
    const amount = isPro ? certInfo.price * 2 : certInfo.price;
    const tradeNo = this.generateTradeNo();
    const tradeDate = this.formatDate(new Date());
    
    const params = {
      MerchantID: this.config.merchantId,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: tradeDate,
      PaymentType: 'aio',
      TotalAmount: amount,
      TradeDesc: encodeURIComponent(`北斗教育證照課程`),
      ItemName: `${certInfo.name}${isPro ? ' Pro版' : ''}`,
      ReturnURL: this.notifyUrl,
      ClientBackURL: this.returnUrl,
      ChoosePayment: 'Credit',
      EncryptType: 1,
      CustomField1: userId,
      CustomField2: 'cert',
      CustomField3: certId
    };
    
    params.CheckMacValue = this.generateCheckMacValue(params);
    
    return {
      url: this.config.apiUrl,
      params,
      tradeNo,
      amount,
      isProduction: this.isProduction
    };
  }
  
  /**
   * 驗證回呼簽章
   */
  verifyCallback(params) {
    const receivedMac = params.CheckMacValue;
    
    // 移除 CheckMacValue 後重新計算
    const paramsToVerify = { ...params };
    delete paramsToVerify.CheckMacValue;
    
    const calculatedMac = this.generateCheckMacValue(paramsToVerify);
    
    return receivedMac === calculatedMac;
  }
  
  /**
   * 格式化日期 (ECPay 格式: yyyy/MM/dd HH:mm:ss)
   */
  formatDate(date) {
    const pad = n => n.toString().padStart(2, '0');
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ` +
           `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  
  /**
   * 取得環境資訊
   */
  getEnvInfo() {
    return {
      isProduction: this.isProduction,
      merchantId: this.config.merchantId,
      apiUrl: this.config.apiUrl,
      returnUrl: this.returnUrl,
      notifyUrl: this.notifyUrl
    };
  }
}

module.exports = ECPayService;
