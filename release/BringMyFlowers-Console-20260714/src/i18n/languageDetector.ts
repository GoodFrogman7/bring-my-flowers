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
  },

  out_for_delivery: {
    en: "🚚 Your flowers are on the way!\nOrder {orderId} is out for delivery and will arrive today.",
    ar: "🚚 زهورك في الطريق!\nالطلب {orderId} خرج للتوصيل وسيصل اليوم.",
    hi: "🚚 आपके फूल रास्ते में हैं!\nऑर्डर {orderId} डिलीवरी के लिए निकल चुका है और आज पहुंचेगा।",
    ur: "🚚 آپ کے پھول راستے میں ہیں!\nآرڈر {orderId} ڈیلیوری کے لیے نکل چکا ہے اور آج پہنچے گا۔"
  },

  delivered: {
    en: "🌸 Order {orderId} has been delivered. Enjoy your flowers — thank you for choosing us!",
    ar: "🌸 تم توصيل الطلب {orderId}. استمتع بزهورك — شكراً لاختيارك لنا!",
    hi: "🌸 ऑर्डर {orderId} डिलीवर हो गया है। अपने फूलों का आनंद लें — हमें चुनने के लिए धन्यवाद!",
    ur: "🌸 آرڈر {orderId} ڈیلیور ہو گیا ہے۔ اپنے پھولوں کا لطف اٹھائیں — ہمیں منتخب کرنے کا شکریہ!"
  },

  delivery_reminder: {
    en: "🌸 Reminder: your flower delivery (order {orderId}) is scheduled for today. See you soon!",
    ar: "🌸 تذكير: توصيل زهورك (الطلب {orderId}) مقرر اليوم. نراك قريباً!",
    hi: "🌸 रिमाइंडर: आपकी फूलों की डिलीवरी (ऑर्डर {orderId}) आज निर्धारित है। जल्द मिलते हैं!",
    ur: "🌸 یاد دہانی: آپ کے پھولوں کی ڈیلیوری (آرڈر {orderId}) آج مقرر ہے۔ جلد ملتے ہیں!"
  },

  recurring_created: {
    en: "🔁 Subscription confirmed!\n{items}, {schedule} — ₹{amount} per delivery.\nFirst delivery: {date}\n\nReply \"pause subscription\" or \"cancel subscription\" anytime.",
    ar: "🔁 تم تأكيد الاشتراك!\n{items}، {schedule} — ₹{amount} لكل توصيلة.\nأول توصيل: {date}\n\nأرسل \"إيقاف الاشتراك\" أو \"إلغاء الاشتراك\" في أي وقت.",
    hi: "🔁 सब्सक्रिप्शन कन्फर्म!\n{items}, {schedule} — ₹{amount} प्रति डिलीवरी।\nपहली डिलीवरी: {date}\n\nकभी भी \"pause subscription\" या \"cancel subscription\" लिखें।",
    ur: "🔁 سبسکرپشن کنفرم!\n{items}، {schedule} — ₹{amount} فی ڈیلیوری۔\nپہلی ڈیلیوری: {date}\n\nکسی بھی وقت \"pause subscription\" یا \"cancel subscription\" لکھیں۔"
  },

  recurring_paused: {
    en: "⏸️ Your subscription {recurringId} is paused. Reply \"resume subscription\" whenever you want deliveries again.",
    ar: "⏸️ تم إيقاف اشتراكك {recurringId} مؤقتاً. أرسل \"استئناف الاشتراك\" متى أردت استئناف التوصيل.",
    hi: "⏸️ आपका सब्सक्रिप्शन {recurringId} रोक दिया गया है। दोबारा शुरू करने के लिए \"resume subscription\" लिखें।",
    ur: "⏸️ آپ کی سبسکرپشن {recurringId} روک دی گئی ہے۔ دوبارہ شروع کرنے کے لیے \"resume subscription\" لکھیں۔"
  },

  recurring_resumed: {
    en: "▶️ Your subscription {recurringId} is active again. Next delivery: {date}.",
    ar: "▶️ اشتراكك {recurringId} نشط مرة أخرى. التوصيل القادم: {date}.",
    hi: "▶️ आपका सब्सक्रिप्शन {recurringId} फिर से सक्रिय है। अगली डिलीवरी: {date}।",
    ur: "▶️ آپ کی سبسکرپشن {recurringId} دوبارہ فعال ہے۔ اگلی ڈیلیوری: {date}۔"
  },

  recurring_cancelled: {
    en: "🛑 Your subscription {recurringId} has been cancelled. You can start a new one anytime — just tell us what you'd like!",
    ar: "🛑 تم إلغاء اشتراكك {recurringId}. يمكنك بدء اشتراك جديد في أي وقت — فقط أخبرنا بما تريد!",
    hi: "🛑 आपका सब्सक्रिप्शन {recurringId} रद्द कर दिया गया है। आप कभी भी नया शुरू कर सकते हैं!",
    ur: "🛑 آپ کی سبسکرپشن {recurringId} منسوخ کر دی گئی ہے۔ آپ کسی بھی وقت نئی شروع کر سکتے ہیں!"
  },

  recurring_skipped_stock: {
    en: "😔 We couldn't prepare your recurring delivery of {items} today — not enough stock. We've alerted the shop and your next delivery is {date}. Sorry!",
    ar: "😔 لم نتمكن من تجهيز توصيلتك الدورية ({items}) اليوم — المخزون غير كافٍ. تم إبلاغ المتجر، وتوصيلتك القادمة {date}. نعتذر!",
    hi: "😔 स्टॉक कम होने से आज आपकी नियमित डिलीवरी ({items}) तैयार नहीं हो सकी। दुकान को सूचित कर दिया गया है, अगली डिलीवरी {date} को होगी। क्षमा करें!",
    ur: "😔 اسٹاک کم ہونے کی وجہ سے آج آپ کی باقاعدہ ڈیلیوری ({items}) تیار نہیں ہو سکی۔ دکان کو اطلاع دے دی گئی ہے، اگلی ڈیلیوری {date} کو ہوگی۔ معذرت!"
  }
};

export function formatResponse(template: string, vars: Record<string, any>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(`{${key}}`, String(value));
  }
  return result;
}
