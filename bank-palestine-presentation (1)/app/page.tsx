"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Rewind,
  University,
  Info,
  Wrench,
  Network,
  Mail,
  Handshake,
  Megaphone,
  CheckCircle,
  Star,
  Target,
  Globe,
  Share2,
  Facebook,
  Lightbulb,
  TrendingUp,
  Building,
  Users,
  List,
  Flag,
  Trophy,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const slides = [
  {
    id: 1,
    icon: Info,
    title: "المقدمة",
    lead: "يُعد بنك فلسطين من أقدم وأكبر البنوك في فلسطين (تأسس عام 1960). يركّز على التواصل الفعّال مع العملاء عبر مزيج من الوسائل التقليدية والرقمية لتعزيز الثقة والاستدامة.",
    cards: [
      {
        icon: Star,
        title: "النقاط الرئيسية",
        items: [
          "تأسّس عام 1960 ويُعد من البنوك الرائدة في فلسطين.",
          "يجمع بين القنوات الرقمية والتقليدية لبناء علاقة مستدامة مع العملاء.",
          "استراتيجيات متكاملة للتواصل، التوعية، التسويق، والمشاركة المجتمعية.",
        ],
      },
      {
        icon: Target,
        title: "الغرض من العرض",
        items: [
          "تحديد وسائل الاتصال والأدوات المستخدمة بوضوح.",
          "توضيح طبيعة الرسائل، الأنشطة الميدانية، وأنواع الإعلانات الفعّالة.",
        ],
      },
    ],
  },
  {
    id: 2,
    icon: Wrench,
    title: "أولاً: وسائل وأدوات الاتصال",
    lead: "الوسائل الرقمية والتقليدية التي يعتمدها بنك فلسطين لضمان الوصول الشامل",
    cards: [
      {
        icon: Globe,
        title: "الموقع الإلكتروني",
        description: "مركز معلوماتي متقدم وخدمات إلكترونية آمنة.",
        items: [
          "فتح حسابات إلكترونيًا بكفاءة عالية.",
          "التحويلات المالية ودفع الفواتير عبر الإنترنت.",
          "معلومات مفصلة عن المنتجات، الفروع، وساعات العمل.",
        ],
      },
      {
        icon: Share2,
        title: "قنوات أخرى",
        items: [
          "البريد الإلكتروني والإشعارات الفورية للعملاء.",
          "الرسائل النصية (SMS) للتنبيهات الأمنية والمعاملات.",
          "خدمة العملاء عبر مركز الاتصال (Call Center) وخطوط الدعم 24/7.",
          "الفروع الواسعة للمقابلات الشخصية والاستشارات.",
          "خدمة USSD للهواتف غير الذكية للوصول الشامل.",
          "قناة واتساب رسمية للتواصل غير المعاملاتي السريع.",
        ],
      },
    ],
  },
  {
    id: 3,
    icon: Network,
    title: "ثانياً: الإنترنت والسوشال ميديا",
    lead: "التواجد الرقمي القوي والاستثمار الاستراتيجي في المحتوى التفاعلي",
    cards: [
      {
        icon: Facebook,
        title: "المنصات الرئيسية",
        items: [
          "فيسبوك: نشر الأخبار والحملات الترويجية اليومية.",
          "إنستغرام: محتوى بصري جذاب وعروض خاصة لبطاقات الائتمان.",
          "تويتر (X): تحديثات سريعة وإعلانات موجزة للأحداث الجارية.",
          "لينكدإن: محتوى مهني يبرز الشراكات والفرص الاستثمارية.",
          "يوتيوب: فيديوهات ترويجية وتقارير مفصلة عن المشاريع المجتمعية.",
        ],
      },
      {
        icon: Megaphone,
        title: "إعلانات ومحتوى رقمي",
        items: [
          "إعلانات ممولة مدروسة لزيادة الوعي بالمنتجات والخدمات الجديدة.",
          "محتوى إعلامي تفاعلي وفيديوهات تبرز مشاريع المجتمع وريادة الأعمال.",
        ],
      },
    ],
  },
  {
    id: 4,
    icon: Mail,
    title: "ثالثاً: طبيعة الرسائل",
    lead: "أنواع الرسائل الاستراتيجية المرسلة عبر قنوات البنك لتعزيز التفاعل",
    cards: [
      {
        icon: Lightbulb,
        title: "رسائل توعوية",
        items: [
          "تشجيع الادخار والتخطيط المالي الشخصي بطرق عملية.",
          "التوعية بأمن الخدمات الإلكترونية ومكافحة الاحتيال.",
          "إرشادات واضحة لاستخدام التطبيقات والخدمات الرقمية مثل USSD.",
        ],
      },
      {
        icon: TrendingUp,
        title: "رسائل تسويقية ومجتمعية",
        items: [
          "عروض حصرية على القروض، البطاقات، وخدمات التوفير والاستثمار.",
          "مبادرات دعم المجتمع، تمكين المرأة، وريادة الأعمال المحلية.",
        ],
      },
    ],
  },
  {
    id: 5,
    icon: Handshake,
    title: "رابعاً: الوسائل المباشرة والأنشطة الميدانية",
    lead: "التفاعل الواقعي والمباشر مع المجتمع والعملاء لبناء الثقة",
    cards: [
      {
        icon: Building,
        title: "الفروع واللقاءات",
        items: [
          "خدمة عملاء متميزة وجهًا لوجه في فروع واسعة الانتشار.",
          "زيارات ميدانية مدروسة للمشاريع الصغيرة ودعم رواد الأعمال.",
        ],
      },
      {
        icon: Users,
        title: "ورش وفعاليات",
        items: [
          "ورش عمل وعقد ندوات للتوعية المالية والتعليم الاقتصادي.",
          "المشاركة الفعالة في معارض وفعاليات اقتصادية محلية وإقليمية.",
          "برامج تدريبية متقدمة مثل Mini MBA ورعاية الفعاليات الثقافية.",
        ],
      },
    ],
  },
  {
    id: 6,
    icon: Megaphone,
    title: "خامساً: طبيعة الإعلانات",
    lead: "قنوات الإعلان المتعددة وأنماط الرسائل الإعلانية الاحترافية",
    cards: [
      {
        icon: List,
        title: "أنواع الإعلانات",
        items: [
          "إعلانات رقمية وممولة على السوشال ميديا والويب للوصول الواسع.",
          "إعلانات مرئية جذابة (فيديو، تلفزيون، راديو) للتأثير العاطفي.",
          "إعلانات مطبوعة ولافتات في الفروع والشوارع الرئيسية.",
          "رسائل SMS وبريد إلكتروني ترويجي مخصصة للعملاء.",
        ],
      },
      {
        icon: Flag,
        title: "طابع الإعلانات",
        items: [
          "طابع وطني واجتماعي يبرز الثقة، الاستقرار، والالتزام بالقيم المحلية.",
          "تسليط الضوء على التطور التكنولوجي وخدمات البنك الرقمية المتقدمة.",
        ],
      },
    ],
  },
  {
    id: 7,
    icon: CheckCircle,
    title: "الخاتمة",
    lead: "ملخص الاستراتيجيات وتوصيات للتطوير المستقبلي",
    cards: [
      {
        icon: Trophy,
        title: "الاستنتاج الرئيسي",
        fullWidth: true,
        description:
          "يقدم بنك فلسطين نموذجًا متكاملاً ومتقدمًا لإدارة الاتصال المؤسسي، من خلال دمج الوسائل التقليدية والحديثة لبناء علاقات قوية ومستدامة مع العملاء والمجتمع. يركّز على الرسائل التوعوية، التسويقية، والمجتمعية لتعزيز صورته كشريك موثوق في التنمية الاقتصادية، مع إمكانيات لتعزيز الذكاء الاصطناعي في التواصل المستقبلي.",
      },
    ],
  },
]

export default function PresentationPage() {
  const [currentSlide, setCurrentSlide] = useState(0)
  const [direction, setDirection] = useState(0)

  const totalSlides = slides.length
  const progress = ((currentSlide + 1) / totalSlides) * 100

  const goToSlide = (index: number) => {
    if (index >= 0 && index < totalSlides) {
      setDirection(index > currentSlide ? 1 : -1)
      setCurrentSlide(index)
    }
  }

  const nextSlide = () => goToSlide(currentSlide + 1)
  const prevSlide = () => goToSlide(currentSlide - 1)
  const firstSlide = () => goToSlide(0)
  const lastSlide = () => goToSlide(totalSlides - 1)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
          prevSlide()
          break
        case "ArrowLeft":
          nextSlide()
          break
        case "Home":
          firstSlide()
          break
        case "End":
          lastSlide()
          break
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [currentSlide])

  const slide = slides[currentSlide]
  const SlideIcon = slide.icon

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0,
      scale: 0.95,
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 50 : -50,
      opacity: 0,
      scale: 0.95,
    }),
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-2 md:p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-pink-950 to-slate-900" />
      <motion.div
        className="absolute inset-0 opacity-30"
        animate={{
          background: [
            "radial-gradient(circle at 20% 50%, rgba(255, 140, 203, 0.3) 0%, transparent 50%)",
            "radial-gradient(circle at 80% 50%, rgba(255, 140, 203, 0.3) 0%, transparent 50%)",
            "radial-gradient(circle at 50% 80%, rgba(255, 140, 203, 0.3) 0%, transparent 50%)",
            "radial-gradient(circle at 20% 50%, rgba(255, 140, 203, 0.3) 0%, transparent 50%)",
          ],
        }}
        transition={{ duration: 10, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
      />

      <div className="w-full max-w-7xl relative z-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <Card className="border-pink-500/20 bg-slate-900/80 backdrop-blur-2xl shadow-2xl shadow-pink-500/10 overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-pink-500 to-transparent" />

            <CardHeader className="border-b border-pink-500/20 space-y-3 bg-gradient-to-b from-slate-900/50 to-transparent py-4 px-4 md:px-6">
              <div className="flex flex-col lg:flex-row gap-4 items-start">
                <div className="flex gap-3 flex-1">
                  <motion.div
                    className="relative w-12 h-12 md:w-14 md:h-14 rounded-xl bg-gradient-to-br from-pink-600 via-pink-500 to-pink-400 flex items-center justify-center shadow-lg flex-shrink-0"
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: "spring", stiffness: 400 }}
                  >
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-pink-400 to-pink-300 opacity-0 blur-xl group-hover:opacity-50 transition-opacity" />
                    <University className="w-6 h-6 md:w-7 md:h-7 text-white relative z-10" />
                    <motion.div
                      className="absolute inset-0 rounded-xl"
                      animate={{
                        boxShadow: [
                          "0 0 20px rgba(255, 140, 203, 0.3)",
                          "0 0 40px rgba(255, 140, 203, 0.5)",
                          "0 0 20px rgba(255, 140, 203, 0.3)",
                        ],
                      }}
                      transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY }}
                    />
                  </motion.div>

                  <div className="flex-1 space-y-2">
                    <div>
                      <h1 className="text-lg md:text-xl font-semibold text-balance bg-gradient-to-l from-pink-400 to-pink-300 bg-clip-text text-transparent">
                        استراتيجيات الاتصال في بنك فلسطين
                      </h1>
                      <p className="text-xs md:text-sm text-white/80 text-pretty mt-0.5">
                        تحليل شامل للوسائل الرقمية والتقليدية والإعلانات
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs bg-slate-800/50 rounded-lg p-2 border border-pink-500/20 backdrop-blur-sm">
                      <div className="space-y-0.5">
                        <span className="text-pink-300/70">المادة:</span>
                        <span className="mr-2 text-white">فن العلاقات العامة</span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-pink-300/70">الدكتورة:</span>
                        <span className="mr-2 text-white">سليكة القاضي</span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-pink-300/70">الطالبة:</span>
                        <span className="mr-2 text-white">إسلام أبو زلطة</span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-pink-300/70">الرقم الجامعي:</span>
                        <span className="mr-2 text-white">22320070</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 self-start lg:self-center">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={prevSlide}
                    disabled={currentSlide === 0}
                    className="hover:bg-pink-500/20 hover:border-pink-400/50 bg-slate-800/50 border-pink-500/30 disabled:opacity-30 transition-all duration-300 hover:shadow-lg hover:shadow-pink-500/20"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={nextSlide}
                    disabled={currentSlide === totalSlides - 1}
                    className="hover:bg-pink-500/20 hover:border-pink-400/50 bg-slate-800/50 border-pink-500/30 disabled:opacity-30 transition-all duration-300 hover:shadow-lg hover:shadow-pink-500/20"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-4 md:p-6">
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                <AnimatePresence mode="wait" custom={direction}>
                  <motion.div
                    key={currentSlide}
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      x: { type: "spring", stiffness: 300, damping: 30 },
                      opacity: { duration: 0.3 },
                      scale: { duration: 0.3 },
                    }}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-2.5 mb-4">
                      <motion.div
                        className="relative w-10 h-10 rounded-lg bg-gradient-to-br from-pink-600 to-pink-400 flex items-center justify-center shadow-lg"
                        whileHover={{ rotate: 5, scale: 1.05 }}
                        transition={{ type: "spring", stiffness: 400 }}
                      >
                        <SlideIcon className="w-5 h-5 text-white relative z-10" />
                        <div className="absolute inset-0 rounded-lg bg-pink-400 opacity-0 blur-xl group-hover:opacity-50 transition-opacity" />
                      </motion.div>
                      <div className="flex-1">
                        <motion.h2
                          className="text-xl md:text-2xl font-semibold bg-gradient-to-l from-pink-400 to-pink-300 bg-clip-text text-transparent text-balance"
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.2 }}
                        >
                          {slide.title}
                        </motion.h2>
                        {slide.lead && (
                          <motion.p
                            className="text-xs md:text-sm text-white/80 mt-0.5 text-pretty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.3 }}
                          >
                            {slide.lead}
                          </motion.p>
                        )}
                      </div>
                    </div>

                    <motion.div
                      className={`grid gap-4 ${slide.cards.some((c) => c.fullWidth) ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}
                      initial="hidden"
                      animate="visible"
                      variants={{
                        visible: {
                          transition: {
                            staggerChildren: 0.1,
                          },
                        },
                      }}
                    >
                      {slide.cards.map((card, idx) => {
                        const CardIcon = card.icon
                        return (
                          <motion.div
                            key={idx}
                            variants={{
                              hidden: { opacity: 0, y: 20 },
                              visible: { opacity: 1, y: 0 },
                            }}
                            transition={{ duration: 0.4 }}
                          >
                            <Card className="group relative bg-slate-800/50 border-pink-500/20 hover:border-pink-400/50 transition-all duration-500 hover:shadow-xl hover:shadow-pink-500/20 overflow-hidden h-full">
                              <CardHeader className="relative z-10 pb-3">
                                <CardTitle className="flex items-center gap-2 text-base md:text-lg text-pink-300 group-hover:text-pink-200 transition-colors">
                                  <motion.div whileHover={{ rotate: 360 }} transition={{ duration: 0.6 }}>
                                    <CardIcon className="w-4 h-4" />
                                  </motion.div>
                                  {card.title}
                                </CardTitle>
                                {card.description && (
                                  <p className="text-xs md:text-sm text-white/70 text-pretty mt-1">
                                    {card.description}
                                  </p>
                                )}
                              </CardHeader>
                              <CardContent className="relative z-10 pt-0">
                                <ul className="space-y-2">
                                  {card.items?.map((item, itemIdx) => (
                                    <motion.li
                                      key={itemIdx}
                                      className="flex gap-2.5 text-xs md:text-sm leading-relaxed group/item"
                                      initial={{ opacity: 0, x: -10 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      transition={{ delay: 0.4 + itemIdx * 0.05 }}
                                    >
                                      <span className="text-pink-400 mt-0.5 flex-shrink-0 group-hover/item:text-pink-300 transition-colors">
                                        ✓
                                      </span>
                                      <span className="text-white/90 text-pretty group-hover/item:text-white transition-colors">
                                        {item}
                                      </span>
                                    </motion.li>
                                  ))}
                                </ul>
                              </CardContent>
                            </Card>
                          </motion.div>
                        )
                      })}
                    </motion.div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </CardContent>

            <div className="border-t border-pink-500/20 p-3 md:p-4 bg-gradient-to-t from-slate-900/50 to-transparent">
              <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                <div className="flex-1 w-full sm:w-auto flex items-center gap-4">
                  <div className="flex-1 relative">
                    <Progress value={progress} className="h-2 bg-slate-800/50" />
                    <motion.div
                      className="absolute top-0 left-0 h-full bg-gradient-to-r from-pink-500 to-pink-400 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                  </div>
                  <span className="text-sm text-white/80 whitespace-nowrap font-medium">
                    شريحة {currentSlide + 1} / {totalSlides}
                  </span>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={firstSlide}
                    disabled={currentSlide === 0}
                    className="hover:bg-pink-500/20 hover:border-pink-400/50 bg-slate-800/50 border-pink-500/30 disabled:opacity-30 transition-all duration-300 hover:shadow-lg hover:shadow-pink-500/20"
                  >
                    <Rewind className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={lastSlide}
                    disabled={currentSlide === totalSlides - 1}
                    className="hover:bg-pink-500/20 hover:border-pink-400/50 bg-slate-800/50 border-pink-500/30 disabled:opacity-30 transition-all duration-300 hover:shadow-lg hover:shadow-pink-500/20"
                  >
                    <FastForward className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-pink-500/10 to-transparent rounded-bl-full" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-pink-500/10 to-transparent rounded-tr-full" />
          </Card>
        </motion.div>

        <motion.div
          className="absolute top-10 right-10 text-pink-400/30"
          animate={{
            y: [0, -10, 0],
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{ duration: 3, repeat: Number.POSITIVE_INFINITY }}
        >
          <Sparkles className="w-6 h-6" />
        </motion.div>
        <motion.div
          className="absolute bottom-10 left-10 text-pink-400/30"
          animate={{
            y: [0, 10, 0],
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{ duration: 4, repeat: Number.POSITIVE_INFINITY, delay: 1 }}
        >
          <Sparkles className="w-8 h-8" />
        </motion.div>
      </div>
    </div>
  )
}
