import logger from '../utils/logger';

export type Language = 'en' | 'ar' | 'hi' | 'ur';

export class LanguageDetector {
  detectLanguage(text: string): Language {
    // Check for Arabic script
    if (/[\u0600-\u06FF]/.test(text)) {
      // Differentiate between Arabic and Urdu
      if (/[\u06A9\u06AF\u06BE\u06C1\u06C3]/.test(text)) {
        return 'ur'; // Urdu-specific characters
      }
      return 'ar'; // Arabic
    }
    
    // Check for Devanagari script (Hindi)
    if (/[\u0900-\u097F]/.test(text)) {
      return 'hi';
    }
    
    // Default to English
    return 'en';
  }

  getLanguageName(lang: Language): string {
    const names = {
      en: 'English',
      ar: 'العربية',
      hi: 'हिन्दी',
      ur: 'اردو'
    };
    return names[lang];
  }
}

export const responses = {
  order_confirmation: {
    en: "✅ Your order #{orderId} is confirmed!\nTotal: ₹{amount}\nDelivery: {date}",
    ar: "✅ تم تأكيد طلبك رقم #{orderId}!\nالمجموع: ₹{amount}\nالتسليم: {date}",
    hi: "✅ आपका ऑर्डर #{orderId} कन्फर्म हो गया!\nकुल: ₹{amount}\nडिलीवरी: {date}",
    ur: "✅ آپ کا آرڈر #{orderId} تصدیق شدہ ہے!\nکل: ₹{amount}\nڈیلیوری: {date}"
  },
  
  order_canceled: {
    en: "Your order #{orderId} has been canceled.\nRefund will be processed in 3-5 days.",
    ar: "تم إلغاء طلبك رقم #{orderId}.\nسيتم معالجة الاسترداد خلال 3-5 أيام.",
    hi: "आपका ऑर्डर #{orderId} रद्द कर दिया गया है.\nरिफंड 3-5 दिनों में प्रोसेस होगा.",
    ur: "آپ کا آرڈر #{orderId} منسوخ کر دیا گیا ہے.\nرقم کی واپسی 3-5 دنوں میں ہوگی."
  },

  payment_link: {
    en: "💳 Please complete your payment:\n{link}\n\nAmount: ₹{amount}\nOrder: {items}",
    ar: "💳 يرجى إكمال الدفع:\n{link}\n\nالمبلغ: ₹{amount}\nالطلب: {items}",
    hi: "💳 कृपया अपना भुगतान पूरा करें:\n{link}\n\nराशि: ₹{amount}\nऑर्डर: {items}",
    ur: "💳 براہ کرم اپنی ادائیگی مکمل کریں:\n{link}\n\nرقم: ₹{amount}\nآرڈر: {items}"
  },

  order_inquiry: {
    en: "To place an order, please tell me:\n- What flowers?\n- How many?\n- Delivery date?",
    ar: "لوضع طلب، يرجى إخباري:\n- أي زهور؟\n- كم عدد؟\n- تاريخ التسليم؟",
    hi: "ऑर्डर देने के लिए, कृपया बताएं:\n- कौन से फूल?\n- कितने?\n- डिलीवरी की तारीख?",
    ur: "آرڈر دینے کے لیے، براہ کرم بتائیں:\n- کون سے پھول?\n- کتنے?\n- ڈیلیوری کی تاریخ?"
  },

  inventory_check: {
    en: "📦 Available flowers:\n{inventory}",
    ar: "📦 الزهور المتوفرة:\n{inventory}",
    hi: "📦 उपलब्ध फूल:\n{inventory}",
    ur: "📦 دستیاب پھول:\n{inventory}"
  },

  low_stock_alert: {
    en: "⚠️ LOW STOCK ALERT\n{flower}: Only {quantity} units left ({percent}% of max)",
    ar: "⚠️ تنبيه المخزون المنخفض\n{flower}: فقط {quantity} وحدة متبقية ({percent}٪ من الحد الأقصى)",
    hi: "⚠️ कम स्टॉक अलर्ट\n{flower}: केवल {quantity} यूनिट बचे हैं ({percent}% अधिकतम से)",
    ur: "⚠️ کم اسٹاک الرٹ\n{flower}: صرف {quantity} یونٹس باقی ہیں ({percent}% زیادہ سے زیادہ)"
  },

  voice_greeting: {
    en: "Welcome to Bring My Flowers. Please tell us your order after the beep.",
    ar: "مرحبا بكم في برينغ ماي فلاورز. يرجى إخبارنا بطلبك بعد الصفارة.",
    hi: "ब्रिंग माई फ्लावर्स में आपका स्वागत है। बीप के बाद अपना ऑर्डर बताएं।",
    ur: "برنگ مائی فلاورز میں خوش آمدید۔ بیپ کے بعد اپنا آرڈر بتائیں۔"
  }
};

export function formatResponse(template: string, vars: Record<string, any>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(`{${key}}`, String(value));
  }
  return result;
}
