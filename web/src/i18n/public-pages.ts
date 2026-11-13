import type { Locale } from "./messages.ts";

/** A run of legal text: plain, or a link whose text is the link label. */
export type LegalPart = string | { href: string; text: string };

export type LegalBlock =
  | { kind: "h2" | "h3" | "p"; parts: LegalPart[] }
  | { kind: "ul"; items: LegalPart[][] };

/**
 * The text of the public pages. Server components only: it is kept out of messages.ts so
 * the client chunks of the private pages do not carry it.
 */
export type PublicPageText = {
  landing: {
    metaTitle: string; metaDescription: string; eyebrow: string; heading: string; lede: string; cta: string; secondary: string; note: string;
    howHeading: string; steps: { title: string; body: string }[];
    coverageHeading: string; coverage: { title: string; body: string }[];
    disclaimerHeading: string; disclaimer: string; finalHeading: string; finalBody: string;
  };
  about: {
    metaTitle: string; metaDescription: string; heading: string; history: string[];
    todayHeading: string; todayItems: string[]; limitsHeading: string; limitsBody: string;
    promiseHeading: string; promiseBody: string; contributeHeading: string; contributeBody: string; githubLabel: string;
  };
  faq: { heading: string; items: { q: string; a: string }[] };
  terms: { title: string; metaDescription: string; blocks: LegalBlock[] };
  privacy: { title: string; metaDescription: string; blocks: LegalBlock[] };
};

export const publicText: Record<Locale, PublicPageText> = {
  ar: {
    landing: {
      "metaTitle": "مواريث: حاسبة المواريث الإسلامية للمذاهب السنية الأربعة",
      "metaDescription": "احسب أنصبة الورثة خطوة بخطوة وفق المذاهب الحنفي والمالكي والشافعي والحنبلي. تدعم الوفيات المتتالية وتعرض البرهان مع ذكر القواعد المعتمدة. لا حاجة إلى حساب.",
      "eyebrow": "حاسبة المواريث الإسلامية",
      "heading": "احسب نصيب كل وارث، وتعرّف على سببه بالتفصيل",
      "lede": "تقسّم مواريث التركة وفق المذهب الحنفي أو المالكي أو الشافعي أو الحنبلي، وتعرض كل خطوة مع القاعدة التي اعتمدت عليها.",
      "cta": "ابدأ حالة بدون حساب",
      "secondary": "اطّلع على طريقة العمل",
      "note": "لا حاجة إلى حساب. أنشئ حسابًا فقط إذا أردت حفظ حالاتك ومشاركتها.",
      "howHeading": "طريقة العمل",
      "steps": [
        {
          "title": "صِف الأسرة",
          "body": "أدخل بيانات المتوفى والتركة والأقارب الأحياء."
        },
        {
          "title": "قارن المذاهب",
          "body": "تحسب مواريث الحالة وفق المذاهب السنية الأربعة؛ فإن اتفقت ظهرت نتيجة واحدة، وإن اختلفت بيّنت مواضع الخلاف وطلبت منك اختيار المذهب."
        },
        {
          "title": "اقرأ البرهان",
          "body": "احصل على نصيب كل وارث مع الخطوات والمراجع التي استند إليها، ونزّل تقريرًا بصيغة PDF (مسودة)."
        }
      ],
      "coverageHeading": "ما الذي تغطيه مواريث",
      "coverage": [
        {
          "title": "المذاهب السنية الأربعة",
          "body": "الحنفي والمالكي والشافعي والحنبلي."
        },
        {
          "title": "الوفيات المتتالية",
          "body": "سجّل وارثًا توفي قبل قسمة التركة لتنتقل حصته إلى ورثته."
        },
        {
          "title": "برهان خطوة بخطوة",
          "body": "يأتي كل نصيب مع الخطوات التي أدت إليه وذكر القاعدة المعتمدة في كل خطوة."
        },
        {
          "title": "تقرير PDF (مسودة)",
          "body": "نزّل مسودة تقرير عن الحالة ونتائجها."
        },
        {
          "title": "الحفظ والمشاركة",
          "body": "بعد إنشاء حساب يمكنك حفظ حالاتك ومشاركتها برابط أو بدعوة عبر البريد الإلكتروني أو عبر واتساب."
        }
      ],
      "disclaimerHeading": "ليست فتوى ولا استشارة قانونية",
      "disclaimer": "مواريث أداة مساعدة على الحساب، ونتائجها ليست فتوى ولا استشارة قانونية. اعرض النتيجة على عالم مؤهل أو محامٍ قبل قسمة التركة. وإذا اختلفت المذاهب أو تعذّر على المحرك الحسم، فإنه يذكر ذلك ولا يعرض أنصبة.",
      "finalHeading": "هل أنت مستعد للحساب؟",
      "finalBody": "تستغرق الحاسبة دقائق قليلة ولا تحتاج إلى حساب."
    },
    about: {
      "metaTitle": "عن مواريث",
      "metaDescription": "مواريث حاسبة مواريث إسلامية مجانية ومفتوحة المصدر وغير ربحية، تعمل عبر الإنترنت منذ عام 2008. تعرّف على ما تقدمه وما لا تقدمه وكيف تساهم.",
      "history": [
        "تم إطلاق موقع المواريث لأول مرة في عام 2008 حيث كانت هناك حاجة واضحة لبرامج تقسيم المواريث و التركات التي تنتج تقارير حسابية وفقًا لقوانين الميراث المعمول بها في المحاكم الشرعية.",
        "أنشئ موقع المواريث لتسهيل تعلم المواريث ومساعدة الناس بتقسيم التركات بأنفسهم توفيرا للوقت والمال.",
        "المواريث النسخة 2.0 هو احدث اصدار للموقع و تم البدء فيه في عام 2020."
      ],
      "todayHeading": "ما تقدمه مواريث اليوم",
      "todayItems": [
        "تحسب الأنصبة وفق المذاهب الحنفي والمالكي والشافعي والحنبلي.",
        "تدعم الوفيات المتتالية.",
        "تعرض كل خطوة من خطوات الحساب مع مراجعها.",
        "تُنتج تقريرًا بصيغة PDF (مسودة).",
        "تتيح لك حفظ الحالات في حساب ومشاركتها."
      ],
      "limitsHeading": "ما لا تقدمه مواريث",
      "limitsBody": "لا تُصدر مواريث فتاوى ولا استشارات قانونية. وإذا اختلفت المذاهب بيّنت مواضع الخلاف وطلبت منك الاختيار، وإذا كانت الأسرة خارج ما يستطيع المحرك الحسم فيه ذكرت ذلك ولم تخمّن.",
      "heading": "من نحن",
      "promiseHeading": "مهمتنا",
      "promiseBody": "نعدكم بتقديم أفضل النتائج لتقسيم التركات بدقة ووضوح وبساطة لا مثيل لها في أي مكان آخر. هدفنا هو أن نقدم للمجتمع أفضل خدمة يستحقها مع الاهتمام باحتياجاته و التجاوب معها.",
      "contributeHeading": "المساهمة",
      "contributeBody": "نحن منفتحون على أي مساهمة ترغب في تقديمها. هذا المشروع مفتوح المصدر وغير ربحي. للمساهمة في البرمجة يرجى زيارة",
      "githubLabel": "مستودع جيثب."
    },
    faq: {
      "heading": "الأسئلة الشائعة",
      "items": [
        {
          "q": "ما هو موقع مواريث؟",
          "a": "مواريث أداة مجانية على الويب تحسب أنصبة الإرث وفق المذاهب الحنفي والمالكي والشافعي والحنبلي، وتعرض كل خطوة من خطوات الحساب."
        },
        {
          "q": "ما المذاهب المدعومة؟",
          "a": "المذاهب السنية الأربعة: الحنفي والمالكي والشافعي والحنبلي. إذا اتفقت على نتيجة الأسرة ظهرت نتيجة واحدة، وإذا اختلفت تختار المذهب فتُحسب الأنصبة بقواعده."
        },
        {
          "q": "هل أحتاج إلى حساب؟",
          "a": "لا. يمكنك إدخال الحالة وعرض النتائج وتنزيل مسودة تقرير PDF دون حساب. الحساب لازم فقط لحفظ الحالات ومشاركتها."
        },
        {
          "q": "هل تدعم الوفيات المتتالية؟",
          "a": "نعم. إذا توفي أحد الورثة قبل قسمة التركة فسجّل وفاته وأضف ورثته، فتُحسب حصته وتنتقل إلى ورثته."
        },
        {
          "q": "كيف أتحقق من صحة النتيجة؟",
          "a": "يأتي كل نصيب مع برهان خطوة بخطوة والقواعد التي استند إليها، فيمكنك مراجعته بنفسك أو عرضه على عالم مؤهل."
        },
        {
          "q": "هل النتيجة فتوى أو استشارة قانونية؟",
          "a": "لا. مواريث أداة مساعدة على الحساب وليست فتوى ولا استشارة قانونية. وللحصول على حكم مُلزِم راجع عالمًا مؤهلًا أو محكمة أو محاميًا."
        },
        {
          "q": "هل أستطيع حفظ الحالة أو مشاركتها؟",
          "a": "نعم، بعد إنشاء حساب. تُحفظ حالاتك في «حالاتي المحفوظة» ويمكنك مشاركتها برابط أو بدعوة عبر البريد الإلكتروني أو عبر واتساب."
        }
      ]
    },
    terms: {
      "title": "الأحكام و الشروط",
      "metaDescription": "الأحكام والشروط الخاصة باستخدام موقع Mawareeth.com.",
      "blocks": [
        {
          "kind": "p",
          "parts": [
            "مرحبا بكم في موقع المواريث !"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "توضح هذه الشروط والأحكام القواعد واللوائح الخاصة باستخدام موقع المواريث ، الموجود على\n https://www.mawareeth.com/."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "بدخولك إلى هذا الموقع ، نفترض أنك تقبل هذه الشروط والأحكام. لا تستمر في استخدام موقع المواريث إذا كنت لا توافق على الاخذ بجميع الشروط والأحكام المذكورة في هذه الصفحة والموافقة عليها."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "تنطبق المصطلحات التالية على هذه الشروط والأحكام وبيان الخصوصية وإشعار إخلاء المسؤولية وجميع الاتفاقيات: يشير \"العميل\" و \"أنت\" و \"الخاص بك\" إليك ، ويقوم الشخص بتسجيل الدخول إلى موقع الويب هذا ومتوافقًا مع شروط وأحكام الشركة. تشير \"الشركة\" و \"أنفسنا\" و \"نحن\" و \"لنا\" إلينا. تشير \"الطرف\" أو \"الأطراف\" أو \"نحن\" إلى كل من العميل وإلينا. تشير جميع الشروط إلى العرض والقبول والنظر في الدفع اللازم لإجراء عملية مساعدتنا للعميل بالطريقة الأنسب للغرض الصريح المتمثل في تلبية احتياجات العميل فيما يتعلق بتقديم الخدمات المعلنة للموقع ، وفقًا لـ ومع مراعاة القانون السائد في هولندا. أي استخدام للمصطلحات المذكورة أعلاه أو كلمات أخرى في صيغة المفرد ,الجمع و / أو هو أو هي أو هم ، يتم اعتبارها قابلة للتبادل وبالتالي تشير إلى نفس الشيء."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "ملفات تعريف الارتباط"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "نحن نستخدم ملفات تعريف الارتباط. من خلال زيارتك للموقع ، انت موافق على استخدام ملفات تعريف الارتباط بالتوافق مع سياسة الخصوصية لموقع المواريث."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "تستخدم معظم مواقع الويب التفاعلية ملفات تعريف الارتباط للسماح لنا باسترداد تفاصيل المستخدم لكل زيارة. يتم استخدام ملفات تعريف الارتباط من خلال موقعنا الإلكتروني لتمكين وظائف مناطق معينة لتسهيل زيارة الأشخاص لموقعنا على الويب. قد يستخدم بعض شركائنا التابعين / المعلنين ملفات تعريف الارتباط."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "الرخصة"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "ما لم ينص على خلاف ذلك ، يمتلك موقع المواريث و / أو المرخصون له حقوق الملكية الفكرية لجميع المواد على الموقع. جميع حقوق الملكية الفكرية محفوظة. يمكنك الوصول إلى هذه المواد من موقع Mawareeth.com لاستخدامك الشخصي الذي يخضع لقيود محددة في هذه الشروط والأحكام."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "يجب أن لا:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "تعيد نشر المواد من الموقع"
            ],
            [
              "تبيع أو تأجر أو تعيد ترخيص مواد من موقع المواريث"
            ],
            [
              "تعيد إنتاج أو تنسخ أو تقلد المواد من موقع المواريث"
            ],
            [
              "تعيد توزيع المحتوى من الموقع"
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "تبدأ هذه الاتفاقية من تاريخه."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "توفر أجزاء من هذا الموقع فرصة للمستخدمين لنشر وتبادل الآراء والمعلومات في مناطق معينة من الموقع. لا يقوم موقع  المواريث بتصفية أو تحرير أو نشر أو مراجعة التعليقات قبل وجودها على الموقع. لا تعكس التعليقات آراء و توجهات موقع المواريث ووكلائه و / أو الشركات التابعة له. تعكس التعليقات آراء وتوجهات الشخص الذي ينشر وجهات نظره وآرائه. إلى الحد الذي تسمح به القوانين المعمول بها ، لن يكون موقع المواريث مسؤول عن التعليقات أو عن أي مسؤولية أو أضرار أو مصروفات نتجت و / أو تكبدت نتيجة لأي استخدام و / أو نشر و / أو ظهور التعليقات على هذا الموقع."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "يحتفظ موقع المواريث بالحق في مراقبة جميع التعليقات وإزالة أي تعليقات يمكن اعتبارها غير لائقة أو مسيئة أو تسبب خرقًا لهذه الشروط والأحكام."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "أنت تضمن وتقر ما يلي:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "يحق لك نشر التعليقات على موقعنا ولديك جميع التراخيص والموافقات اللازمة للقيام بذلك ؛"
            ],
            [
              "لا تنتهك التعليقات أي حق من حقوق الملكية الفكرية ، بما في ذلك على سبيل المثال لا الحصر حقوق الطبع والنشر أو براءة الاختراع أو العلامة التجارية لأي طرف ثالث ؛"
            ],
            [
              "لا تحتوي التعليقات على أي مواد تشهيرية أو مسيئة أو غير لائقة أو غير قانونية تعد انتهاكًا للخصوصية"
            ],
            [
              "لن يتم استخدام التعليقات لطلب أو الترويج لأعمال أو أنشطة تجارية أو أنشطة غير قانونية."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "بموجب هذا ، فإنك تمنح موقع المواريث ترخيصًا غير حصري لاستخدام وإعادة إنتاج وتحرير وتفويض الآخرين لاستخدام وإعادة إنتاج وتحرير أي من تعليقاتك في أي وجميع الأشكال أو التنسيقات أو الوسائط."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "الارتباط التشعبي إلى المحتوى لدينا"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "يمكن للمنظمات التالية الارتباط بموقعنا على الويب دون موافقة كتابية مسبقة:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "الوكالات الحكومية؛"
            ],
            [
              "محركات البحث؛"
            ],
            [
              "المنظمات الإخبارية ؛"
            ],
            [
              "قد يربط موزعو الدليل عبر الإنترنت بموقعنا بنفس الطريقة التي يربطون بها مواقع الويب الخاصة بشركات أخرى مدرجة ؛ و"
            ],
            [
              "الشركات المعتمدة على مستوى النظام باستثناء طلب المؤسسات غير الربحية ومراكز التسوق الخيرية ومجموعات جمع التبرعات الخيرية التي قد لا تكون مرتبطة بموقعنا على الويب."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "قد ترتبط هذه المنظمات بصفحتنا الرئيسية أو بالمنشورات أو بمعلومات أخرى على موقع الويب طالما أن الرابط: (أ) ليس خادعًا بأي شكل من الأشكال ؛ (ب) لا يعني او يوحي رعاية أو تبني أو موافقة الطرف المرتبط ومنتجاته و / أو خدماته ؛ و (ج) يناسب سياق موقع الطرف المرتبط."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "قد ننظر في طلبات الربط الأخرى من الأنواع التالية من المنظمات ونوافق عليها:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "مصادر معلومات المستهلك و / أو الأعمال التجارية المعروفة ؛"
            ],
            [
              "مواقع المجتمع على شبكة الإنترنت ؛"
            ],
            [
              "الجمعيات أو المجموعات الأخرى التي تمثل الجمعيات الخيرية ؛"
            ],
            [
              "موزعين الدليل على الانترنت؛"
            ],
            [
              "بوابات الإنترنت ؛"
            ],
            [
              "شركات المحاسبة والقانون والاستشارات ؛ و"
            ],
            [
              "المؤسسات التعليمية والجمعيات التجارية."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "سنوافق على طلبات الارتباط من هذه المنظمات إذا قررنا ما يلي: (أ) الرابط لن يجعلنا ننظر إلى أنفسنا أو إلى أعمالنا المعتمدة بشكل غير مستحب؛ (ب) ليس لدى المنظمة أي سجلات سلبية معنا ؛ (ج) الفائدة التي تعود علينا من ظهور الارتباط التشعبي تعوض غياب موقع المواريث؛ و (د) الرابط في السياق العام للحصول على المعلومات."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "قد ترتبط هذه المنظمات بصفحتنا الرئيسية طالما أن الرابط: (أ) ليس خادعًا بأي شكل من الأشكال ؛ (ب) لا يعني او يوحي رعاية أو تبني أو موافقة الطرف المرتبط ومنتجاته و / أو خدماته ؛ و (ج) يناسب سياق موقع الطرف المرتبط."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "إذا كنت أحد المؤسسات المذكورة في الفقرة 2 أعلاه وترغب في الارتباط بموقعنا ، فيجب عليك إبلاغنا عن طريق إرسال بريد إلكتروني إلى موقع المواريث. يُرجى تضمين اسمك واسم مؤسستك ومعلومات الاتصال بالإضافة إلى العنوان الخاص بموقعك وقائمة بأي عناوين تنوي الارتباط بها على موقعنا الإلكتروني وقائمة بالعناوين على موقعنا التي ترغب في ربطها. انتظر 2-3 أسابيع للرد."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "يمكن للمنظمات المعتمدة الارتباط التشعبي بموقعنا على النحو التالي:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "باستخدام اسم شركتنا ؛ أو"
            ],
            [
              "باستخدام محدد موقع الموارد المرتبط بـ ؛ أو"
            ],
            [
              "من خلال استخدام أي وصف آخر لموقعنا على الويب الذي يتم ربطه بهذا يكون منطقيًا في سياق وتنسيق المحتوى على موقع الطرف المرتبط."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "لن يُسمح باستخدام شعار موقع المواريث أو أي عمل فني آخر للربط في غياب اتفاقية ترخيص العلامة التجارية."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "الإطارات المضمنة"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "بدون الموافقة المسبقة والإذن الخطي ، لا يجوز لك إنشاء إطارات حول صفحات الويب الخاصة بنا التي تغير بأي شكل من الأشكال العرض أو المظهر المرئي لموقعنا على الويب."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "مسؤولية المحتوى"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "لن نكون مسؤولين عن أي محتوى يظهر على موقع الويب الخاص بك. أنت توافق على حمايتنا والدفاع عنا ضد جميع المطالبات التي تنشأ على موقع الويب الخاص بك. يجب ألا يظهر أي رابط (روابط) على أي موقع ويب يمكن تفسيره على أنه تشهيري أو فاحش أو إجرامي ، أو ينتهك أو ينتهك أو يدعو إلى التعدي أو انتهاك لحقوق أي طرف ثالث."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "خصوصيتك"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "يرجى قراءة سياسة الخصوصية"
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "حفظ الحقوق"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "نحتفظ بالحق في طلب إزالة جميع الروابط أو أي رابط معين إلى موقعنا الإلكتروني. أنت توافق على إزالة جميع الروابط إلى موقعنا الإلكتروني فورًا عند الطلب. نحتفظ أيضًا بالحق في تعديل هذه البنود والشروط وسياسة الربط في أي وقت. من خلال الربط المستمر إلى موقعنا ، فإنك توافق على الالتزام واتباع شروط وأحكام الربط هذه."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "إزالة الروابط من موقعنا"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "إذا وجدت أي رابط على موقعنا مسيء لأي سبب من الأسباب ، فأنت حر في الاتصال وإبلاغنا في أي لحظة. سنأخذ بعين الاعتبار طلبات إزالة الروابط ولكننا لسنا ملزمين بإزالتها أو بالرد عليك مباشرة."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "نحن لا نضمن صحة المعلومات الواردة في هذا الموقع ، ولا نضمن اكتمالها أو دقتها ؛ كما أننا لا نعد بضمان أن يظل الموقع متاحًا أو أن المواد الموجودة على الموقع محدثة."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "إخلاء المسؤولية"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "إلى أقصى حد يسمح به القانون المعمول به ، نستبعد جميع الإقرارات والضمانات والشروط المتعلقة بموقعنا واستخدام هذا الموقع. لا يوجد شيء في بيان إخلاء المسؤولية هذا :"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "يحدد أو يستبعد مسؤوليتنا أو مسؤوليتك عن الوفاة أو الإصابة الشخصية ؛"
            ],
            [
              "يحدد أو يستبعد مسؤوليتنا أو مسؤوليتك عن الاحتيال أو التحريف الاحتيالي ؛"
            ],
            [
              "يحدد أي من مسؤوليتنا أو مسؤولياتك بأي طريقة غير مسموح بها بموجب القانون المعمول به ؛ أو"
            ],
            [
              "يستبعد أي من مسؤوليتنا أو مسؤولياتك التي قد لا يتم استبعادها بموجب القانون المعمول به."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "قيود وحظر المسئولية المنصوص عليها في هذا القسم وأماكن أخرى في هذا الإخلاء للمسؤولية: (أ) تخضع للفقرة السابقة ؛ و (ب) تحكم جميع الالتزامات الناشئة بموجب بيان إخلاء المسؤولية ، بما في ذلك الخصوم الناشئة عن العقد والتعويض عن الإخلال بالواجب القانوني."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "طالما تم توفير الموقع الإلكتروني والمعلومات والخدمات على الموقع مجانًا ، فلن نكون مسؤولين عن أي خسارة أو ضرر من أي نوع."
          ]
        }
      ]
    },
    privacy: {
      "title": "سياسة الخصوصية لموقع المواريث النسخة 2.0",
      "metaDescription": "كيف يجمع موقع Mawareeth.com المعلومات ويستخدمها، وملفات تعريف الارتباط، وحقوقك في حماية بياناتك.",
      "blocks": [
        {
          "kind": "p",
          "parts": [
            "في موقع المواريث, والذي يمكن الوصل اليه عن طريق الرابط\n https://www.mawareeth.com\n,نضع خصوصية الزائرين ضمن اهتماماتنا الرئيسية. تحتوي هذه النسخة من سياسة الخصوصية على أنواع من المعلومات التي تسجل و تأخذ في موقع المواريث و كيفية استخدامها."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "اذا كان لديكم أي استفسارات او أسئلة حول سياسة الخصوصية الخاصة بنا , لا تترددوا بالاتصال بنا."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "سياسة الخصوصية هذه تنطبق على المعاملات الالكترونية من خلال الانترنت الخاصة بنا و هي صالحة للزائرين لموقعنا بالنسبة للمعلومات التي يشاركونها/او تأخذ في موقع المواريث. لا تنطبق هذه السياسة على المعلومات التي تأخذ من دون اتصال بالأنترنت و أي قناة اتصال غير الموقع."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "الموافقة و القبول"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "بمجرد استخدامك لموقعنا, فانت موافق على سياسة الخصوصية و تقبل جميع ما ورد في بنودها."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "المعلومات التي نجمعها"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "المعلومات الشخصية التي تطلب منك و الأسباب التي طلبت من اجلها سوف يتم ايضاحها في حينها."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "اذا تم التواصل معنا مباشرة, يحتمل ان نحصل على معلومات إضافية عنك مثل اسمك, عنوان البريد الالكتروني, رقم الهاتف, محتوى الرسالة و/او المرفقات التي يمكن ان ترسلها لنا, و أي معلومات أخرى تختار ان تزودنا بها."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "عند تسجيلك لحساب لدينا, يحتمل ان نطلب منك معلومات الاتصال الخاصة بك, شاملة لبنود مثل الاسم, اسم الشركة, العنوان, البريد الالكتروني, ورقم الهاتف."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "كيف نستخدم معلوماتك"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "نستخدم المعلومات التي نحصل عليها بطرق مختلفة, تشمل:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "تزويد, تشغيل و صيانة الموقع"
            ],
            [
              "تحسين, تخصيص, وتطوير موقعنا"
            ],
            [
              "فهم و تحليل كيف تقوم باستخدام موقعنا"
            ],
            [
              "تطوير منتجات, خدمات, مميزات, و وظائف جديدة"
            ],
            [
              "الاتصال بكم, مباشرة او من خلال احد شركائنا, و تشمل خدمة العميل, لتزويدكم بالتحديثات و المعلومات المتعلقة بالموقع, و لأهداف تسويقية و دعائية"
            ],
            [
              "ارسال رسائل بريد الكتروني"
            ],
            [
              "البحث عن و منع الاحتيال"
            ]
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "ملفات السجل"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "يتبع موقع المواريث اجراء قياسي / نمطي بحفظ ملفات سجل. تسجل هذه الملفات الزائين عند زيارتهم للموقع. تقوم جميع شركات الاستضافة بهذا الاجراء و جزء من اجراء تحليل خدمات الاستضافة. تشمل المعلومات التي تسجل عناوين الانترنت IP , نوع المتصفح, مزود خدمة الانترنت,التاريخ و الوقت, الصفحات المرجعية ,و عدد النقرات. لا ترتبط هذه المعلومات باي معلومات يمكن التعرف عليها شخصيا.هدف جمع هذه المعلومات هو تحليل التوجهات, ادارة الموقع, مراقبة تحركات الزوار على الموقع,و جمع البيانات الديموغرافية."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "ملفات تعريف الارتباط و كاشف المستخدم"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "يقوم موقع المواريث كغيره من المواقع باستخدام ملفات تعريف الارتباط .تقوم هذه الملفات بتخزين المعلومات التي تشمل تفضيلات الزوار, الصفحات التي قام الزائر بالوصول اليها او زيارتها. هذه البيانات تستخدم لتخصيص تجربة المستخدم بملائمة المحتوى حسب متصفح الزائر و/او معلومات أخرى."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "للمزيد من المعلومات حول ملفات الارتباط, نرجو الاطلاع على",
            {
              "href": "https://www.cookieconsent.com/what-are-cookies/",
              "text": "ما هي ملفات الارتباط"
            }
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "ملفات تعريف ارتباط اعلانات جوجل"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "جوجل هو احد الاطراف الاخرى من الموردين في موقعنا. و يستخدم ايضا ملفات ارتباط تعرف ب DART cookies, وذلك للقيام بتزويدالزائرين للموقع بمحتوى اعلاني استنادا الى زيارتهم السابقة لمواقع اخرى.مع ذلك يمكن للزوار رفض استخدام هذه الملفات بزيارة جوجل  و سياسة الخصوصية لشبكة المحتوى عل الرابط التالي -",
            {
              "href": "https://policies.google.com/technologies/ads",
              "text": "https://policies.google.com/technologies/ads"
            }
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "شركائنا المعلنين"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "قد يستخدم احد المعلنين في الموقع ملفات تعريف الارتباط. لقد ادرجنا شركائنا المعلنين في اللائحة ادناه.كل من شركائنا المعلنين لديه سياسة خصوصية خاصة به لسياسته على المعلومات الخاصة بالمستخدمين.للوصول بشكل اسهل قمنا بتوفير الروابط لسياسة الخصوصية الخاص بهم ادناه."
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "جوجل",
              {
                "href": "https://policies.google.com/technologies/ads",
                "text": "https://policies.google.com/technologies/ads"
              }
            ]
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "سياسة الخصوصية للشركاء المعلنين"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "يمكنك الرجوع على هذه اللائحة للحصول على سياسة الخصوصية لكل من الشركاء المعلنين في موقع المواريث."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "خوادم الاطراف الاخرى او الشبكات المعلنة تستخدم تقنيات مثل ملفات تعريف الارتباط, جافاسكريب, و ملفات بيكون لعرض الاعلانات و الروابط التي تظهر في موقع المواريث Mawareeth.com,و ترسل مباشرة لمتصفح المستخدم. وهم عندها يحصلون على عنوان الانترنت الخاص بك تلقائيا.تستخدم هذه التقنيات لقياس مدى فعالية حمالاتهم الاعلانية و/او لتخصيص المحتوى الاعلاني الذي تجده عند زيارتك للمواقع."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "موقع المواريث ليس لديه أي وصول او تحكم بهذه الملفات التي تستخدم من قبل الأطراف المعلنة الأخرى."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "سياسات خصوصية الطرف الثالث"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "سياسة خصوصية لا تنطبق على المعلنين الآخرين أو مواقع الويب. وبالتالي ، ننصحك بالرجوع إلى سياسات الخصوصية المعنية لخوادم الإعلانات الخاصة بالأطراف الأخرى للحصول على معلومات أكثر تفصيلاً. قد تتضمن ممارساتهم وتعليماتهم حول كيفية إلغاء الاشتراك في بعض الميزات. قد تجد قائمة كاملة بسياسات الخصوصية هذه والروابط هنا: روابط سياسة الخصوصية."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "يمكنك اختيار تعطيل ملفات تعريف الارتباط من خلال خيارات المتصفح الخاصة بك. لمعرفة المزيد من المعلومات التفصيلية حول إدارة ملفات تعريف الارتباط مع متصفحات ويب محددة ، يمكن العثور عليها في مواقع الويب الخاصة بالمتصفحات. ما هي ملفات تعريف الارتباط؟"
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "حقوق خصوصية CCPA (لا تبيع معلوماتي الشخصية)"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "بموجب CCPA ، من بين حقوق أخرى ، يحق للمستهلكين في كاليفورنيا:"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "طلب من نشاط تجاري يجمع بيانات شخصية ان يفصح عن الفئات و بيانات محددة من المعلومات الشخصيةالتي تم جمعها."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "طلب من نشاط تجاري حذف أي معلومات شخصية عن المستهلك تم جمعها."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "طلب من مشاط تجاري يقوم ببيع المعلومات الخاصة بالمستهلكين , بعدم بيع معلومات المستهلك الخاصة."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "اذا قمت بطلب, يتوجب علينا الرد عليك خلال فترة شهر واحد. اذا رغبت بممارسة أي من هذه الحقوق نرجو التواصل معنا."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "حقوق حماية البيانات الخاصة باللائحة العامة لحماية البيانات"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "نود التأكد من أنك على دراية تامة بجميع حقوق حماية البيانات الخاصة بك. يحق لكل مستخدم ما يلي:"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "الحق في الوصول - لديك الحق في طلب نسخ من بياناتك الشخصية. قد نفرض عليك رسومًا رمزية مقابل هذه الخدمة."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "حق التصحيح - يحق لك طلب تصحيح أي معلومات تعتقد أنها غير دقيقة. لديك أيضًا الحق في أن تطلب استكمال المعلومات التي تعتقد أنها غير مكتملة."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "حق المحو - يحق لك طلب مسح بياناتك الشخصية ، في ظل ظروف معينة."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "الحق في تقييد المعالجة - يحق لك طلب تقييد معالجة بياناتك الشخصية ، في ظل ظروف معينة."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "الحق في الاعتراض على المعالجة - يحق لك الاعتراض على معالجتنا لبياناتك الشخصية ، في ظل ظروف معينة."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "الحق في نقل البيانات - يحق لك طلب نقل البيانات التي جمعناها إلى منظمة أخرى ، أو مباشرة إليك ، في ظل ظروف معينة."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "اذا قمت بطلب, يتوجب علينا الرد عليك خلال فترة شهر واحد. اذا رغبت بممارسة أي من هذه الحقوق نرجو التواصل معنا."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "معلومات الأطفال"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "جزء آخر من أولويتنا هو إضافة حماية للأطفال أثناء استخدام الإنترنت. نشجع الآباء والأوصياء على مراقبة نشاط الأطفال عبر الإنترنت والمشاركة فيه و / أو مراقبته وتوجيهه."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "لا يقوم موقع المواريث بجمع أي معلومات شخصية قابلة للتعريف من الأطفال تحت سن 13 عامًا. إذا كنت تعتقد أن طفلك قدم هذا النوع من المعلومات على موقعنا ،فنحن نشجعك بشدة على الاتصال بنا على الفور وسنبذل قصارى جهدنا من أجل إزالة هذه المعلومات على الفور من سجلاتنا."
          ]
        }
      ]
    },
  },
  en: {
    landing: {
      "metaTitle": "Mawareeth: Islamic inheritance calculator for the four Sunni schools",
      "metaDescription": "Calculate Islamic inheritance shares step by step under the Hanafi, Maliki, Shafi'i and Hanbali schools. Handles successive deaths, shows the proof and cites the rules. No account needed.",
      "eyebrow": "Islamic inheritance calculator",
      "heading": "Calculate each heir's share, and see exactly why",
      "lede": "Mawareeth divides an estate under the Hanafi, Maliki, Shafi'i or Hanbali school and shows every step with the rule it relies on.",
      "cta": "Start a case without an account",
      "secondary": "See how it works",
      "note": "No account needed. Create one only to save and share your cases.",
      "howHeading": "How it works",
      "steps": [
        {
          "title": "Describe the family",
          "body": "Enter the deceased, the estate and the surviving relatives."
        },
        {
          "title": "Compare the schools",
          "body": "Mawareeth works out the case under the four Sunni schools. If they agree you get one result; if they differ, it shows how and asks you to choose."
        },
        {
          "title": "Read the proof",
          "body": "Get each heir's share with the steps and citations behind it, and download a draft PDF report."
        }
      ],
      "coverageHeading": "What Mawareeth covers",
      "coverage": [
        {
          "title": "Four Sunni schools",
          "body": "Hanafi, Maliki, Shafi'i and Hanbali."
        },
        {
          "title": "Successive deaths",
          "body": "Record an heir who died before the estate was divided, and their share passes to their own heirs."
        },
        {
          "title": "Step-by-step proof",
          "body": "Every share comes with the steps that produced it and the rule cited at each step."
        },
        {
          "title": "Draft PDF report",
          "body": "Download a draft report of the case and its results."
        },
        {
          "title": "Save and share",
          "body": "With an account, save your cases and share them by link, email invitation or WhatsApp."
        }
      ],
      "disclaimerHeading": "Not a fatwa, not legal advice",
      "disclaimer": "Mawareeth is a calculation aid. Its results are not a fatwa and not legal advice. Before dividing an estate, have a qualified scholar or a lawyer review the result. Where the schools disagree or the engine cannot decide, it says so and shows no shares.",
      "finalHeading": "Ready to calculate?",
      "finalBody": "It takes a few minutes and needs no account."
    },
    about: {
      "metaTitle": "About Mawareeth",
      "metaDescription": "Mawareeth is a free, open-source, non-profit Islamic inheritance calculator, online since 2008. Learn what it does, what it does not do and how to contribute.",
      "history": [
        "Mawareeth.com was first launched in 2008, when there was a clear and strong need for inheritance distribution software that produces calculation reports in line with inheritance law and court requirements.",
        "Mawareeth.com was started to make inheritance learning easier and help people do their own calculations without the need of lawyers saving people time and money.",
        "Mawareeth 2.0 is the latest release for our website and it was started in 2020."
      ],
      "todayHeading": "What Mawareeth does today",
      "todayItems": [
        "Calculates shares under the Hanafi, Maliki, Shafi'i and Hanbali schools.",
        "Handles successive deaths.",
        "Shows each step of the calculation with its citations.",
        "Produces a draft PDF report.",
        "Lets you save cases to an account and share them."
      ],
      "limitsHeading": "What it does not do",
      "limitsBody": "Mawareeth does not issue fatwas or legal advice. When the schools disagree, it shows how and asks you to choose; when a family is outside what the engine can decide, it says so instead of guessing.",
      "heading": "About Us",
      "promiseHeading": "Our promise",
      "promiseBody": "We promise to provide the best calculations results with accuracy, clarity and simplicity that is not matched elsewhere. Our goal is to provide to our community the best service they deserve paying attention and responding to their needs.",
      "contributeHeading": "Contribution",
      "contributeBody": "We are open to any contribution you are willing to make. This project is open source and non-profit. To contribute to source code please visit",
      "githubLabel": "GitHub Repository."
    },
    faq: {
      "heading": "Frequently asked questions",
      "items": [
        {
          "q": "What is Mawareeth?",
          "a": "Mawareeth is a free web tool that calculates Islamic inheritance shares under the Hanafi, Maliki, Shafi'i and Hanbali schools and shows every step of the calculation."
        },
        {
          "q": "Which schools of law does it support?",
          "a": "The four Sunni schools: Hanafi, Maliki, Shafi'i and Hanbali. When they give the same result for a family you see one result; when they differ, you choose the school and the shares follow its rules."
        },
        {
          "q": "Do I need an account?",
          "a": "No. You can enter a case, read the results and download a draft PDF report without an account. An account is only needed to save cases and share them."
        },
        {
          "q": "Does it handle successive deaths?",
          "a": "Yes. If an heir dies before the estate is divided, record the death and add their heirs: their share is calculated and passes to their heirs."
        },
        {
          "q": "How can I check that the result is right?",
          "a": "Every share comes with a step-by-step proof and the rules it cites, so you can review it yourself or take it to a qualified scholar."
        },
        {
          "q": "Is the result a fatwa or legal advice?",
          "a": "No. Mawareeth is a calculation aid, not a fatwa and not legal advice. For a binding ruling, consult a qualified scholar, a court or a lawyer."
        },
        {
          "q": "Can I save or share a case?",
          "a": "Yes, with an account. Your cases are kept under \"My saved cases\" and you can share them by link, email invitation or WhatsApp."
        }
      ]
    },
    terms: {
      "title": "Terms and Conditions",
      "metaDescription": "The terms and conditions for using Mawareeth.com.",
      "blocks": [
        {
          "kind": "p",
          "parts": [
            "Welcome to Mawareeth.com!"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "These terms and conditions outline the rules and regulations for the use of Mawareeth 2.0's Website, located at https://www.mawareeth.com/."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "By accessing this website we assume you accept these terms and conditions. Do not continue to use Mawareeth.com if you do not agree to take all of the terms and conditions stated on this page."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "The following terminology applies to these Terms and Conditions, Privacy Statement and Disclaimer Notice and all Agreements: \"Client\", \"You\" and \"Your\" refers to you, the person log on this website and compliant to the Company’s terms and conditions. \"The Company\", \"Ourselves\", \"We\", \"Our\" and \"Us\", refers to our Company. \"Party\", \"Parties\", or \"Us\", refers to both the Client and ourselves. All terms refer to the offer, acceptance and consideration of payment necessary to undertake the process of our assistance to the Client in the most appropriate manner for the express purpose of meeting the Client’s needs in respect of provision of the Company’s stated services, in accordance with and subject to, prevailing law of Netherlands. Any use of the above terminology or other words in the singular, plural, capitalization and/or he/she or they, are taken as interchangeable and therefore as referring to same."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Cookies"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "We employ the use of cookies. By accessing Mawareeth.com, you agreed to use cookies in agreement with the Mawareeth 2.0's Privacy Policy."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Most interactive websites use cookies to let us retrieve the user’s details for each visit. Cookies are used by our website to enable the functionality of certain areas to make it easier for people visiting our website. Some of our affiliate/advertising partners may also use cookies."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "License"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Unless otherwise stated, Mawareeth 2.0 and/or its licensors own the intellectual property rights for all material on Mawareeth.com. All intellectual property rights are reserved. You may access this from Mawareeth.com for your own personal use subjected to restrictions set in these terms and conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "You must not:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "Republish material from Mawareeth.com"
            ],
            [
              "Sell, rent or sub-license material from Mawareeth.com"
            ],
            [
              "Reproduce, duplicate or copy material from Mawareeth.com"
            ],
            [
              "Redistribute content from Mawareeth.com"
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "This Agreement shall begin on the date hereof."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Parts of this website offer an opportunity for users to post and exchange opinions and information in certain areas of the website. Mawareeth 2.0 does not filter, edit, publish or review Comments prior to their presence on the website. Comments do not reflect the views and opinions of Mawareeth 2.0,its agents and/or affiliates. Comments reflect the views and opinions of the person who post their views and opinions. To the extent permitted by applicable laws, Mawareeth 2.0 shall not be liable for the Comments or for any liability, damages or expenses caused and/or suffered as a result of any use of and/or posting of and/or appearance of the Comments on this website."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Mawareeth 2.0 reserves the right to monitor all Comments and to remove any Comments which can be considered inappropriate, offensive or causes breach of these Terms and Conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "You warrant and represent that:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "You are entitled to post the Comments on our website and have all necessary licenses and consents to do so;"
            ],
            [
              "The Comments do not invade any intellectual property right, including without limitation copyright, patent or trademark of any third party;"
            ],
            [
              "The Comments do not contain any defamatory, libelous, offensive, indecent or otherwise unlawful material which is an invasion of privacy"
            ],
            [
              "The Comments will not be used to solicit or promote business or custom or present commercial activities or unlawful activity."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "You hereby grant Mawareeth 2.0 a non-exclusive license to use, reproduce, edit and authorize others to use, reproduce and edit any of your Comments in any and all forms, formats or media."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Hyperlinking to our Content"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "The following organizations may link to our Website without prior written approval:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "Government agencies;"
            ],
            [
              "Search engines;"
            ],
            [
              "News organizations;"
            ],
            [
              "Online directory distributors may link to our Website in the same manner as they hyperlink to the Websites of other listed businesses; and"
            ],
            [
              "System wide Accredited Businesses except soliciting non-profit organizations, charity shopping malls, and charity fundraising groups which may not hyperlink to our Web site."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "These organizations may link to our home page, to publications or to other Website information so long as the link: (a) is not in any way deceptive; (b) does not falsely imply sponsorship, endorsement or approval of the linking party and its products and/or services; and (c) fits within the context of the linking party’s site."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "We may consider and approve other link requests from the following types of organizations:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "commonly-known consumer and/or business information sources;"
            ],
            [
              "dot.com community sites;"
            ],
            [
              "associations or other groups representing charities;"
            ],
            [
              "online directory distributors;"
            ],
            [
              "internet portals;"
            ],
            [
              "accounting, law and consulting firms; and"
            ],
            [
              "educational institutions and trade associations."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "We will approve link requests from these organizations if we decide that: (a) the link would not make us look unfavorably to ourselves or to our accredited businesses; (b) the organization does not have any negative records with us; (c) the benefit to us from the visibility of the hyperlink compensates the absence of Mawareeth 2.0; and (d) the link is in the context of general resource information."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "These organizations may link to our home page so long as the link: (a) is not in any way deceptive; (b) does not falsely imply sponsorship, endorsement or approval of the linking party and its products or services; and (c) fits within the context of the linking party’s site."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "If you are one of the organizations listed in paragraph 2 above and are interested in linking to our website, you must inform us by sending an e-mail to Mawareeth 2.0. Please include your name, your organization name, contact information as well as the URL of your site, a list of any URLs from which you intend to link to our Website, and a list of the URLs on our site to which you would like to link. Wait 2-3 weeks for a response."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Approved organizations may hyperlink to our Website as follows:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "By use of our corporate name; or"
            ],
            [
              "By use of the uniform resource locator being linked to; or"
            ],
            [
              "By use of any other description of our Website being linked to that makes sense within the context and format of content on the linking party’s site."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "No use of Mawareeth 2.0's logo or other artwork will be allowed for linking absent a trademark license agreement."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "iFrames"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Without prior approval and written permission, you may not create frames around our Webpages that alter in any way the visual presentation or appearance of our Website."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Content Liability"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "We shall not be hold responsible for any content that appears on your Website. You agree to protect and defend us against all claims that is rising on your Website. No link(s) should appear on any Website that may be interpreted as libelous, obscene or criminal, or which infringes, otherwise violates, or advocates the infringement or other violation of, any third party rights."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Your Privacy"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Please read Privacy Policy"
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Reservation of Rights"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "We reserve the right to request that you remove all links or any particular link to our Website. You approve to immediately remove all links to our Website upon request. We also reserve the right to amen these terms and conditions and it’s linking policy at any time. By continuously linking to our Website, you agree to be bound to and follow these linking terms and conditions."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Removal of links from our website"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "If you find any link on our Website that is offensive for any reason, you are free to contact and inform us any moment. We will consider requests to remove links but we are not obligated to or so or to respond to you directly."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "We do not ensure that the information on this website is correct, we do not warrant its completeness or accuracy; nor do we promise to ensure that the website remains available or that the material on the website is kept up to date."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Disclaimer"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "To the maximum extent permitted by applicable law, we exclude all representations, warranties and conditions relating to our website and the use of this website. Nothing in this disclaimer will:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "limit or exclude our or your liability for death or personal injury;"
            ],
            [
              "limit or exclude our or your liability for fraud or fraudulent misrepresentation;"
            ],
            [
              "limit any of our or your liabilities in any way that is not permitted under applicable law; or"
            ],
            [
              "exclude any of our or your liabilities that may not be excluded under applicable law."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "The limitations and prohibitions of liability set in this Section and elsewhere in this disclaimer: (a) are subject to the preceding paragraph; and (b) govern all liabilities arising under the disclaimer, including liabilities arising in contract, in tort and for breach of statutory duty."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "As long as the website and the information and services on the website are provided free of charge, we will not be liable for any loss or damage of any nature."
          ]
        }
      ]
    },
    privacy: {
      "title": "Privacy Policy for Mawareeth 2.0",
      "metaDescription": "How Mawareeth.com collects and uses information, cookies and your data protection rights.",
      "blocks": [
        {
          "kind": "p",
          "parts": [
            "At Mawareeth.com, accessible from https://www.mawareeth.com/, one of our main priorities is the privacy of our visitors. This Privacy Policy document contains types of information that is collected and recorded by Mawareeth.com and how we use it."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "If you have additional questions or require more information about our Privacy Policy, do not hesitate to contact us."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "This Privacy Policy applies only to our online activities and is valid for visitors to our website with regards to the information that they shared and/or collect in Mawareeth.com. This policy is not applicable to any information collected offline or via channels other than this website."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Consent"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "By using our website, you hereby consent to our Privacy Policy and agree to its terms."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Information we collect"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "The personal information that you are asked to provide, and the reasons why you are asked to provide it, will be made clear to you at the point we ask you to provide your personal information."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "If you contact us directly, we may receive additional information about you such as your name, email address, phone number, the contents of the message and/or attachments you may send us, and any other information you may choose to provide."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "When you register for an Account, we may ask for your contact information, including items such as name, company name, address, email address, and telephone number."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "How we use your information"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "We use the information we collect in various ways, including to:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "Provide, operate, and maintain our webste"
            ],
            [
              "Improve, personalize, and expand our webste"
            ],
            [
              "Understand and analyze how you use our webste"
            ],
            [
              "Develop new products, services, features, and functionality"
            ],
            [
              "Communicate with you, either directly or through one of our partners, including for customer service, to provide you with updates and other information relating to the webste, and for marketing and promotional purposes"
            ],
            [
              "Send you emails"
            ],
            [
              "Find and prevent fraud"
            ]
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Log Files"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Mawareeth.com follows a standard procedure of using log files. These files log visitors when they visit websites. All hosting companies do this and a part of hosting services' analytics. The information collected by log files include internet protocol (IP) addresses, browser type, Internet Service Provider (ISP), date and time stamp, referring/exit pages, and possibly the number of clicks. These are not linked to any information that is personally identifiable. The purpose of the information is for analyzing trends, administering the site, tracking users' movement on the website, and gathering demographic information."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Cookies and Web Beacons"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Like any other website, Mawareeth.com uses 'cookies'. These cookies are used to store information including visitors' preferences, and the pages on the website that the visitor accessed or visited. The information is used to optimize the users' experience by customizing our web page content based on visitors' browser type and/or other information."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "For more general information on cookies, please read",
            {
              "href": "https://www.cookieconsent.com/what-are-cookies/",
              "text": "What Are Cookies"
            }
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Google DoubleClick DART Cookie"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Google is one of a third-party vendor on our site. It also uses cookies, known as DART cookies, to serve ads to our site visitors based upon their visit to www.website.com and other sites on the internet. However, visitors may choose to decline the use of DART cookies by visiting the Google ad and content network Privacy Policy at the following URL –",
            {
              "href": "https://policies.google.com/technologies/ads",
              "text": "https://policies.google.com/technologies/ads"
            }
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Our Advertising Partners"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Some of advertisers on our site may use cookies and web beacons. Our advertising partners are listed below. Each of our advertising partners has their own Privacy Policy for their policies on user data. For easier access, we hyperlinked to their Privacy Policies below."
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "Google",
              {
                "href": "https://policies.google.com/technologies/ads",
                "text": "https://policies.google.com/technologies/ads"
              }
            ]
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Advertising Partners Privacy Policies"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "You may consult this list to find the Privacy Policy for each of the advertising partners of Mawareeth.com."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Third-party ad servers or ad networks uses technologies like cookies, JavaScript, or Web Beacons that are used in their respective advertisements and links that appear on Mawareeth.com, which are sent directly to users' browser. They automatically receive your IP address when this occurs. These technologies are used to measure the effectiveness of their advertising campaigns and/or to personalize the advertising content that you see on websites that you visit."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Note that Mawareeth.com has no access to or control over these cookies that are used by third-party advertisers."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Third Party Privacy Policies"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Mawareeth.com's Privacy Policy does not apply to other advertisers or websites. Thus, we are advising you to consult the respective Privacy Policies of these third-party ad servers for more detailed information. It may include their practices and instructions about how to opt-out of certain options. You may find a complete list of these Privacy Policies and their links here: Privacy Policy Links."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "You can choose to disable cookies through your individual browser options. To know more detailed information about cookie management with specific web browsers, it can be found at the browsers' respective websites. What Are Cookies?"
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "CCPA Privacy Rights (Do Not Sell My Personal Information)"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Under the CCPA, among other rights, California consumers have the right to:"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Request that a business that collects a consumer's personal data disclose the categories and specific pieces of personal data that a business has collected about consumers."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Request that a business delete any personal data about the consumer that a business has collected."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Request that a business that sells a consumer's personal data, not sell the consumer's personal data."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "If you make a request, we have one month to respond to you. If you would like to exercise any of these rights, please contact us."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "GDPR Data Protection Rights"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "We would like to make sure you are fully aware of all of your data protection rights. Every user is entitled to the following:"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "The right to access – You have the right to request copies of your personal data. We may charge you a small fee for this service."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "The right to rectification – You have the right to request that we correct any information you believe is inaccurate. You also have the right to request that we complete the information you believe is incomplete."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "The right to erasure – You have the right to request that we erase your personal data, under certain conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "The right to restrict processing – You have the right to request that we restrict the processing of your personal data, under certain conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "The right to object to processing – You have the right to object to our processing of your personal data, under certain conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "The right to data portability – You have the right to request that we transfer the data that we have collected to another organization, or directly to you, under certain conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "If you make a request, we have one month to respond to you. If you would like to exercise any of these rights, please contact us."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Children's Information"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Another part of our priority is adding protection for children while using the internet. We encourage parents and guardians to observe, participate in, and/or monitor and guide their online activity."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Mawareeth.com does not knowingly collect any Personal Identifiable Information from children under the age of 13. If you think that your child provided this kind of information on our website, we strongly encourage you to contact us immediately and we will do our best efforts to promptly remove such information from our records."
          ]
        }
      ]
    },
  },
  fr: {
    landing: {
      "metaTitle": "Mawareeth : calculateur d’héritage islamique pour les quatre écoles sunnites",
      "metaDescription": "Calculez les parts d’héritage islamique étape par étape selon les écoles hanafite, malikite, chaféite et hanbalite. Prend en charge les décès successifs, montre la preuve et cite les règles. Aucun compte requis.",
      "eyebrow": "Calculateur d’héritage islamique",
      "heading": "Calculez la part de chaque héritier et voyez précisément pourquoi",
      "lede": "Mawareeth répartit une succession selon l’école hanafite, malikite, chaféite ou hanbalite et montre chaque étape avec la règle sur laquelle elle s’appuie.",
      "cta": "Commencer un dossier sans compte",
      "secondary": "Voir comment ça marche",
      "note": "Aucun compte requis. Créez-en un seulement pour enregistrer et partager vos dossiers.",
      "howHeading": "Comment ça marche",
      "steps": [
        {
          "title": "Décrivez la famille",
          "body": "Saisissez le défunt, la succession et les proches survivants."
        },
        {
          "title": "Comparez les écoles",
          "body": "Mawareeth calcule le cas selon les quatre écoles sunnites : si elles concordent, vous obtenez un seul résultat ; si elles divergent, il montre en quoi et vous demande de choisir."
        },
        {
          "title": "Lisez la preuve",
          "body": "Obtenez la part de chaque héritier avec les étapes et les références qui la fondent, puis téléchargez un brouillon de rapport PDF."
        }
      ],
      "coverageHeading": "Ce que couvre Mawareeth",
      "coverage": [
        {
          "title": "Quatre écoles sunnites",
          "body": "Hanafite, malikite, chaféite et hanbalite."
        },
        {
          "title": "Décès successifs",
          "body": "Enregistrez un héritier décédé avant le partage de la succession : sa part passe à ses propres héritiers."
        },
        {
          "title": "Preuve étape par étape",
          "body": "Chaque part est accompagnée des étapes qui y mènent et de la règle citée à chaque étape."
        },
        {
          "title": "Brouillon de rapport PDF",
          "body": "Téléchargez un brouillon de rapport du dossier et de ses résultats."
        },
        {
          "title": "Enregistrer et partager",
          "body": "Avec un compte, enregistrez vos dossiers et partagez-les par lien, par invitation par e-mail ou via WhatsApp."
        }
      ],
      "disclaimerHeading": "Ni fatwa, ni conseil juridique",
      "disclaimer": "Mawareeth est une aide au calcul. Ses résultats ne constituent ni une fatwa ni un conseil juridique. Avant de partager une succession, faites relire le résultat par un savant qualifié ou un avocat. Lorsque les écoles divergent ou que le moteur ne peut pas trancher, il l’indique et n’affiche aucune part.",
      "finalHeading": "Prêt à calculer ?",
      "finalBody": "Cela prend quelques minutes et ne demande aucun compte."
    },
    about: {
      "metaTitle": "À propos de Mawareeth",
      "metaDescription": "Mawareeth est un calculateur d’héritage islamique gratuit, open source et à but non lucratif, en ligne depuis 2008. Découvrez ce qu’il fait, ce qu’il ne fait pas et comment contribuer.",
      "history": [
        "Mawareeth.com a été lancé pour la première fois en 2008, au cours de laquelle il y avait un besoin clair et fort de logiciel de distribution d'héritage qui produise des rapports de calcul conformément aux lois sur les successions et aux exigences des tribunaux.",
        "Mawareeth.com a été lancé pour faciliter l'apprentissage de l'héritage et aider les gens à faire leurs propres calculs, ce qui leur fait gagner du temps et de l'argent.",
        "Mawareeth 2.0 est la dernière version de notre site Web et elle a été lancée en 2020."
      ],
      "todayHeading": "Ce que fait Mawareeth aujourd’hui",
      "todayItems": [
        "Calcule les parts selon les écoles hanafite, malikite, chaféite et hanbalite.",
        "Prend en charge les décès successifs.",
        "Montre chaque étape du calcul avec ses références.",
        "Produit un brouillon de rapport PDF.",
        "Permet d’enregistrer des dossiers dans un compte et de les partager."
      ],
      "limitsHeading": "Ce qu’il ne fait pas",
      "limitsBody": "Mawareeth n’émet ni fatwa ni conseil juridique. Lorsque les écoles divergent, il montre en quoi et vous demande de choisir ; lorsqu’une famille dépasse ce que le moteur peut trancher, il l’indique au lieu de deviner.",
      "heading": "A propos de nous",
      "promiseHeading": "Notre promesse",
      "promiseBody": "Nous nous engageons à fournir les meilleurs résultats de calcul avec une précision, une clarté et une simplicité qui ne sont égalées nulle part ailleurs. Notre objectif est de fournir à notre communauté le meilleur service qu'elle mérite en prêtant attention et en répondant à ses besoins.",
      "contributeHeading": "Contribution",
      "contributeBody": "Nous sommes ouverts à toute contribution que vous souhaitez apporter. Ce projet est open source et à but non lucratif. Pour contribuer au code source, veuillez visiter",
      "githubLabel": "Référentiel GitHub."
    },
    faq: {
      "heading": "Questions fréquentes",
      "items": [
        {
          "q": "Qu’est-ce que Mawareeth ?",
          "a": "Mawareeth est un outil web gratuit qui calcule les parts d’héritage selon les écoles hanafite, malikite, chaféite et hanbalite et montre chaque étape du calcul."
        },
        {
          "q": "Quelles écoles juridiques sont prises en charge ?",
          "a": "Les quatre écoles sunnites : hanafite, malikite, chaféite et hanbalite. Lorsqu’elles donnent le même résultat pour une famille, vous voyez un seul résultat ; lorsqu’elles divergent, vous choisissez l’école et les parts suivent ses règles."
        },
        {
          "q": "Ai-je besoin d’un compte ?",
          "a": "Non. Vous pouvez saisir un dossier, consulter les résultats et télécharger un brouillon de rapport PDF sans compte. Un compte n’est nécessaire que pour enregistrer et partager des dossiers."
        },
        {
          "q": "Les décès successifs sont-ils pris en charge ?",
          "a": "Oui. Si un héritier meurt avant le partage, enregistrez son décès et ajoutez ses héritiers : sa part est calculée puis transmise à ses héritiers."
        },
        {
          "q": "Comment vérifier que le résultat est juste ?",
          "a": "Chaque part est accompagnée d’une preuve étape par étape et des règles citées : vous pouvez la relire vous-même ou la soumettre à un savant qualifié."
        },
        {
          "q": "Le résultat est-il une fatwa ou un conseil juridique ?",
          "a": "Non. Mawareeth est une aide au calcul, pas une fatwa ni un conseil juridique. Pour un avis qui fait autorité, consultez un savant qualifié, un tribunal ou un avocat."
        },
        {
          "q": "Puis-je enregistrer ou partager un dossier ?",
          "a": "Oui, avec un compte. Vos dossiers sont conservés dans « Mes cas enregistrés » et vous pouvez les partager par lien, par invitation par e-mail ou via WhatsApp."
        }
      ]
    },
    terms: {
      "title": "Termes et conditions",
      "metaDescription": "Les termes et conditions d’utilisation de Mawareeth.com.",
      "blocks": [
        {
          "kind": "p",
          "parts": [
            "Bienvenue sur Mawareeth.com!"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Ces termes et conditions décrivent les règles et réglementations pour l'utilisation du site Web de Mawareeth 2.0, situé à https://www.mawareeth.com/."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "En accédant à ce site Web, nous supposons que vous acceptez ces termes et conditions. Ne continuez pas à utiliser Mawareeth.com si vous n'acceptez pas de respecter toutes les conditions générales énoncées sur cette page."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "La terminologie suivante s'applique aux présentes conditions générales, à la déclaration de confidentialité et à la clause de non-responsabilité et à tous les accords: «client», «vous» et «votre» font référence à vous, la personne connectée sur ce site Web et conforme aux conditions générales de la société. «La société», «nous-mêmes», «nous», «notre» et «nous» fait référence à notre société. «Partie», «Parties» ou «Nous» fait référence à la fois au Client et à nous-mêmes. Tous les termes se réfèrent à l'offre, l'acceptation et la considération du paiement nécessaires pour entreprendre le processus de notre assistance au Client de la manière la plus appropriée dans le but exprès de répondre aux besoins du Client en ce qui concerne la fourniture des services déclarés de la Société, conformément à et soumis à la loi en vigueur des Pays-Bas. Toute utilisation de la terminologie ci-dessus ou d'autres mots au singulier, au pluriel, en majuscules et / ou il ou elles, sont considérés comme interchangeables et donc comme faisant référence à ceux-ci."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Cookies"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Nous utilisons des cookies. En accédant à Mawareeth.com, vous avez accepté d'utiliser des cookies en accord avec la politique de confidentialité de Mawareeth 2.0."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "La plupart des sites Web interactifs utilisent des cookies pour nous permettre de récupérer les détails de l'utilisateur pour chaque visite. Les cookies sont utilisés par notre site Web pour permettre la fonctionnalité de certaines zones afin de faciliter la navigation des personnes sur notre site Web. Certains de nos partenaires affiliés / publicitaires peuvent également utiliser des cookies."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Licence"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Sauf indication contraire, Mawareeth 2.0 et / ou ses concédants de licence détiennent les droits de propriété intellectuelle pour tout le matériel sur Mawareeth.com. Tous les droits de propriété intellectuelle sont réservés. Vous pouvez y accéder à partir de Mawareeth.com pour votre usage personnel soumis aux restrictions définies dans ces termes et conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Vous ne devez pas:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "Republier le matériel de Mawareeth.com"
            ],
            [
              "Vendre, louer ou sous-licencier du matériel de Mawareeth.com"
            ],
            [
              "Reproduire, dupliquer ou copier du matériel à partir de Mawareeth.com"
            ],
            [
              "Redistribuer le contenu de Mawareeth.com"
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Le présent accord prend effet à la date des présentes."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Certaines parties de ce site Web offrent aux utilisateurs la possibilité de publier et d'échanger des opinions et des informations dans certaines zones du site Web. Mawareeth 2.0 ne filtre pas, ne modifie pas, ne publie pas et ne révise pas les commentaires avant leur présence sur le site Web. Les commentaires ne reflètent pas les vues et opinions de Mawareeth 2.0, de ses agents et / ou affiliés. Les commentaires reflètent les points de vue et opinions de la personne qui publie leurs points de vue et opinions. Dans la mesure permise par les lois applicables, Mawareeth 2.0 ne sera pas responsable des Commentaires ou de toute responsabilité, dommages ou dépenses causés et / ou subis du fait de toute utilisation et / ou publication et / ou apparition des Commentaires sur ce site."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Mawareeth 2.0 se réserve le droit de surveiller tous les commentaires et de supprimer tout commentaire pouvant être considéré comme inapproprié, offensant ou entraînant une violation des présentes conditions générales."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Vous garantissez et déclarez que:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "Vous êtes autorisé à publier les commentaires sur notre site Web et à disposer de toutes les licences et autorisations nécessaires pour le faire;"
            ],
            [
              "Les Commentaires n'empiètent sur aucun droit de propriété intellectuelle, y compris, sans limitation, le droit d'auteur, le brevet ou la marque d'un tiers;"
            ],
            [
              "Les commentaires ne contiennent aucun élément diffamatoire, calomnieux, offensant, indécent ou autrement illégal constituant une atteinte à la vie privée"
            ],
            [
              "Les commentaires ne seront pas utilisés pour solliciter ou promouvoir des activités commerciales ou personnalisées ou présenter des activités commerciales ou des activités illégales."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Par la présente, vous accordez à Mawareeth 2.0 une licence non exclusive pour utiliser, reproduire, modifier et autoriser d'autres personnes à utiliser, reproduire et modifier n'importe lequel de vos commentaires sous toutes formes, formats ou supports."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Hyperlien vers notre contenu"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Les organisations suivantes peuvent créer un lien vers notre site Web sans autorisation écrite préalable:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "Organismes gouvernementaux;"
            ],
            [
              "Moteurs de recherche;"
            ],
            [
              "Organismes de presse;"
            ],
            [
              "Les distributeurs d'annuaires en ligne peuvent créer un lien vers notre site Web de la même manière qu'ils établissent un lien hypertexte vers les sites Web d'autres entreprises répertoriées; et"
            ],
            [
              "Entreprises accréditées à l'échelle du système, à l'exception de la sollicitation d'organisations à but non lucratif, de centres commerciaux de bienfaisance et de groupes de collecte de fonds caritatifs qui ne peuvent pas créer de lien hypertexte vers notre site Web."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Ces organisations peuvent créer un lien vers notre page d'accueil, des publications ou d'autres informations du site Web tant que le lien: (a) n'est en aucun cas trompeur; (b) n'implique pas faussement le parrainage, l'approbation ou l'approbation de la partie de liaison et de ses produits et / ou services; et (c) s'inscrit dans le contexte du site de la partie de liaison."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Nous pouvons considérer et approuver d'autres demandes de liens des types d'organisations suivants:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "les sources d'information sur les consommateurs et / ou les entreprises connues;"
            ],
            [
              "sites communautaires dot.com;"
            ],
            [
              "les associations ou autres groupes représentant des œuvres de bienfaisance;"
            ],
            [
              "distributeurs d'annuaires en ligne;"
            ],
            [
              "portails Internet;"
            ],
            [
              "cabinets comptables, juridiques et de conseil; et"
            ],
            [
              "établissements d'enseignement et associations professionnelles."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Nous approuverons les demandes de lien de ces organisations si nous décidons que: (a) le lien ne nous ferait pas nuire à nous-mêmes ou à nos entreprises accréditées; (b) l'organisation n'a aucun dossier négatif avec nous; (c) l'avantage pour nous de la visibilité de l'hyperlien compense l'absence de Mawareeth 2.0; et (d) le lien se situe dans le contexte des informations générales sur les ressources."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Ces organisations peuvent créer un lien vers notre page d'accueil tant que le lien: (a) n'est en aucun cas trompeur; (b) n'implique pas faussement le parrainage, l'approbation ou l'approbation de la partie de liaison et de ses produits ou services; et (c) s'inscrit dans le contexte du site de la partie de liaison."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Si vous êtes l'une des organisations énumérées au paragraphe 2 ci-dessus et que vous souhaitez créer un lien vers notre site Web, vous devez nous en informer en envoyant un e-mail à Mawareeth 2.0. Veuillez inclure votre nom, le nom de votre organisation, vos coordonnées ainsi que l'URL de votre site, une liste de toutes les URL à partir desquelles vous avez l'intention de créer un lien vers notre site Web, et une liste des URL sur notre site vers lesquelles vous souhaitez lien. Attendez 2-3 semaines pour une réponse."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Les organisations approuvées peuvent créer un lien hypertexte vers notre site Web comme suit:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "En utilisant notre raison sociale; ou"
            ],
            [
              "En utilisant le localisateur de ressources uniforme lié à; ou"
            ],
            [
              "En utilisant toute autre description de notre site Web liée à qui a du sens dans le contexte et le format du contenu sur le site de la partie de liaison."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Aucune utilisation du logo de Mawareeth 2.0 ou d'autres illustrations ne sera autorisée pour le lien en l'absence d'un accord de licence de marque."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "iFrames"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Sans autorisation préalable et autorisation écrite, vous ne pouvez pas créer de cadres autour de nos pages Web qui altèrent de quelque manière que ce soit la présentation visuelle ou l'apparence de notre site Web."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Responsabilité du contenu"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Nous ne serons pas tenus responsables de tout contenu qui apparaît sur votre site Web. Vous acceptez de nous protéger et de nous défendre contre toutes les réclamations qui augmentent sur votre site Web. Aucun lien ne doit apparaître sur un site Web qui peut être interprété comme diffamatoire, obscène ou criminel, ou qui viole, viole ou préconise la violation ou toute autre violation des droits de tiers."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Votre vie privée"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Veuillez lire la politique de confidentialité"
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Réserve de droits"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Nous nous réservons le droit de vous demander de supprimer tous les liens ou tout lien particulier vers notre site Web. Vous acceptez de supprimer immédiatement tous les liens vers notre site Web sur demande. Nous nous réservons également le droit de modifier ces termes et conditions et sa politique de liens à tout moment. En vous connectant en continu à notre site Web, vous acceptez d'être lié et de suivre ces conditions générales de liaison."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Suppression de liens de notre site Web"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Si vous trouvez un lien sur notre site Web offensant pour quelque raison que ce soit, vous êtes libre de nous contacter et de nous informer à tout moment. Nous prendrons en considération les demandes de suppression de liens mais nous ne sommes pas obligés de le faire ou de vous répondre directement."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Nous ne garantissons pas que les informations sur ce site sont correctes, nous ne garantissons pas leur exhaustivité ou leur exactitude; nous ne promettons pas non plus de veiller à ce que le site Web reste disponible ou à ce que le contenu du site Web soit mis à jour."
          ]
        },
        {
          "kind": "h3",
          "parts": [
            "Avertissement"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Dans la mesure maximale permise par la loi applicable, nous excluons toutes les représentations, garanties et conditions relatives à notre site Web et à l'utilisation de ce site Web. Rien dans cette clause de non-responsabilité ne:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "limiter ou exclure notre ou votre responsabilité en cas de décès ou de blessure corporelle;"
            ],
            [
              "limiter ou exclure notre ou votre responsabilité pour fraude ou fausse déclaration frauduleuse;"
            ],
            [
              "limiter nos ou vos responsabilités d'une manière non autorisée par la loi applicable; ou"
            ],
            [
              "exclure tout ou partie de nos responsabilités qui ne peuvent être exclues en vertu de la loi applicable."
            ]
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Les limitations et interdictions de responsabilité définies dans cette section et ailleurs dans cette clause de non-responsabilité: (a) sont soumises au paragraphe précédent; et (b) régir toutes les responsabilités découlant de la renonciation, y compris les responsabilités découlant du contrat, en responsabilité délictuelle et pour manquement à une obligation légale."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Tant que le site Web et les informations et services sur le site Web sont fournis gratuitement, nous ne serons pas responsables de toute perte ou dommage de quelque nature que ce soit."
          ]
        }
      ]
    },
    privacy: {
      "title": "Politique de confidentialité de Mawareeth 2.0",
      "metaDescription": "Comment Mawareeth.com collecte et utilise les informations, les cookies et vos droits en matière de protection des données.",
      "blocks": [
        {
          "kind": "p",
          "parts": [
            "Chez Mawareeth.com, accessible depuis https://www.mawareeth.com/, l'une de nos principales priorités est la confidentialité de nos visiteurs. Ce document de politique de confidentialité contient les types d'informations collectées et enregistrées par Mawareeth.com et comment nous les utilisons."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Si vous avez des questions supplémentaires ou avez besoin de plus d'informations sur notre politique de confidentialité, n'hésitez pas à nous contacter."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Cette politique de confidentialité s'applique uniquement à nos activités en ligne et est valable pour les visiteurs de notre site Web en ce qui concerne les informations qu'ils ont partagées et / ou collectées sur Mawareeth.com. Cette politique ne s'applique pas aux informations collectées hors ligne ou via des canaux autres que ce site Web."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Consentement"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "En utilisant notre site Web, vous acceptez par la présente notre politique de confidentialité et acceptez ses conditions."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Informations que nous collectons"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Les informations personnelles que vous êtes invité à fournir, et les raisons pour lesquelles vous êtes invité à les fournir, vous seront précisées au moment où nous vous demanderons de fournir vos informations personnelles."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Si vous nous contactez directement, nous pouvons recevoir des informations supplémentaires vous concernant, telles que votre nom, votre adresse e-mail, votre numéro de téléphone, le contenu du message et / ou des pièces jointes que vous pouvez nous envoyer, ainsi que toute autre information que vous pourriez choisir de fournir."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Lorsque vous vous inscrivez pour un compte, nous pouvons vous demander vos coordonnées, y compris des éléments tels que le nom, le nom de l'entreprise, l'adresse, l'adresse e-mail et le numéro de téléphone."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Comment nous utilisons vos informations"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Nous utilisons les informations que nous collectons de différentes manières, notamment pour:"
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "Fournir, exploiter et entretenir notre site Web"
            ],
            [
              "Améliorez, personnalisez et développez notre site Web"
            ],
            [
              "Comprendre et analyser la façon dont vous utilisez notre site Web"
            ],
            [
              "Développer de nouveaux produits, services, caractéristiques et fonctionnalités"
            ],
            [
              "Communiquer avec vous, soit directement, soit par l'intermédiaire de l'un de nos partenaires, y compris pour le service client, pour vous fournir des mises à jour et d'autres informations relatives au site Web, ainsi qu'à des fins de marketing et de promotion"
            ],
            [
              "Vous envoyer des courriels"
            ],
            [
              "Trouver et prévenir la fraude"
            ]
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Fichiers journaux"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Mawareeth.com suit une procédure standard d'utilisation des fichiers journaux. Ces fichiers enregistrent les visiteurs lorsqu'ils visitent des sites Web. Toutes les sociétés d'hébergement font cela et font partie de l'analyse des services d'hébergement. Les informations collectées par les fichiers journaux incluent les adresses de protocole Internet (IP), le type de navigateur, le fournisseur d'accès Internet (FAI), la date et l'heure, les pages de renvoi / sortie et éventuellement le nombre de clics. Ceux-ci ne sont liés à aucune information personnellement identifiable. Le but de l'information est d'analyser les tendances, d'administrer le site, de suivre les mouvements des utilisateurs sur le site Web et de recueillir des informations démographiques."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Cookies et balises Web"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Comme tout autre site Web, Mawareeth.com utilise des «cookies». Ces cookies sont utilisés pour stocker des informations, y compris les préférences des visiteurs, et les pages du site Web auxquelles le visiteur a accédé ou visité. Les informations sont utilisées pour optimiser l'expérience des utilisateurs en personnalisant le contenu de notre page Web en fonction du type de navigateur des visiteurs et / ou d'autres informations."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Pour plus d'informations générales sur les cookies, veuillez lire",
            {
              "href": "https://www.cookieconsent.com/what-are-cookies/",
              "text": "Que sont les cookies"
            }
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Cookie Google DoubleClick DART"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Google est l'un des fournisseurs tiers sur notre site. Il utilise également des cookies, appelés cookies DART, pour diffuser des annonces aux visiteurs de notre site en fonction de leur visite sur www.website.com et d'autres sites sur Internet. Cependant, les visiteurs peuvent choisir de refuser l'utilisation des cookies DART en visitant la politique de confidentialité du réseau de publicité et de contenu Google à l'URL suivante -",
            {
              "href": "https://policies.google.com/technologies/ads",
              "text": "https://policies.google.com/technologies/ads"
            }
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Nos partenaires publicitaires"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Certains annonceurs de notre site peuvent utiliser des cookies et des balises Web. Nos partenaires publicitaires sont listés ci-dessous. Chacun de nos partenaires publicitaires a sa propre politique de confidentialité pour ses politiques sur les données des utilisateurs. Pour un accès plus facile, nous avons créé un lien hypertexte vers leurs politiques de confidentialité ci-dessous."
          ]
        },
        {
          "kind": "ul",
          "items": [
            [
              "Google",
              {
                "href": "https://policies.google.com/technologies/ads",
                "text": "https://policies.google.com/technologies/ads"
              }
            ]
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Partenaires publicitaires Politiques de confidentialité"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Vous pouvez consulter cette liste pour trouver la politique de confidentialité de chacun des partenaires publicitaires de Mawareeth.com."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Les serveurs publicitaires ou réseaux publicitaires tiers utilisent des technologies telles que les cookies, JavaScript ou les balises Web qui sont utilisées dans leurs publicités et liens respectifs qui apparaissent sur Mawareeth.com, qui sont envoyés directement au navigateur des utilisateurs. Ils reçoivent automatiquement votre adresse IP lorsque cela se produit. Ces technologies sont utilisées pour mesurer l'efficacité de leurs campagnes publicitaires et / ou pour personnaliser le contenu publicitaire que vous voyez sur les sites Web que vous visitez."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Notez que Mawareeth.com n'a aucun accès ni contrôle sur ces cookies qui sont utilisés par des annonceurs tiers."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Politiques de confidentialité des tiers"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "La politique de confidentialité de Mawareeth.com ne s'applique pas aux autres annonceurs ou sites Web. Ainsi, nous vous conseillons de consulter les politiques de confidentialité respectives de ces serveurs publicitaires tiers pour des informations plus détaillées. Il peut inclure leurs pratiques et instructions sur la façon de désactiver certaines options. Vous pouvez trouver une liste complète de ces politiques de confidentialité et leurs liens ici: Liens de politique de confidentialité."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Vous pouvez choisir de désactiver les cookies via vos options de navigateur individuelles. Pour connaître des informations plus détaillées sur la gestion des cookies avec des navigateurs Web spécifiques, vous pouvez les trouver sur les sites Web respectifs des navigateurs. Que sont les cookies?"
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Droits de confidentialité de l'ACCP (ne vendez pas mes renseignements personnels)"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "En vertu de la CCPA, entre autres droits, les consommateurs californiens ont le droit de:"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Demander à une entreprise qui collecte des données personnelles d'un consommateur de divulguer les catégories et éléments spécifiques de données personnelles qu'une entreprise a collectés sur les consommateurs."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Demander qu'une entreprise supprime toutes les données personnelles sur le consommateur qu'une entreprise a collectées."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Demander à une entreprise qui vend les données personnelles d'un consommateur de ne pas vendre les données personnelles du consommateur."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Si vous faites une demande, nous avons un mois pour vous répondre. Si vous souhaitez exercer l'un de ces droits, veuillez nous contacter."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Droits de protection des données GDPR"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Nous souhaitons nous assurer que vous êtes pleinement conscient de tous vos droits en matière de protection des données. Chaque utilisateur a droit à ce qui suit:"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Le droit d'accès - Vous avez le droit de demander des copies de vos données personnelles. Nous pouvons vous facturer une somme modique pour ce service."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Le droit de rectification - Vous avez le droit de demander que nous corrigions toute information que vous jugez inexacte. Vous avez également le droit de demander que nous complétions les informations que vous jugez incomplètes."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Le droit à l'effacement - Vous avez le droit de demander que nous effacions vos données personnelles, sous certaines conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Le droit de restreindre le traitement - Vous avez le droit de nous demander de restreindre le traitement de vos données personnelles, sous certaines conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Le droit de vous opposer au traitement - Vous avez le droit de vous opposer à notre traitement de vos données personnelles, sous certaines conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Le droit à la portabilité des données - Vous avez le droit de demander que nous transférions les données que nous avons collectées à une autre organisation, ou directement à vous, sous certaines conditions."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Si vous faites une demande, nous avons un mois pour vous répondre. Si vous souhaitez exercer l'un de ces droits, veuillez nous contacter."
          ]
        },
        {
          "kind": "h2",
          "parts": [
            "Information pour les enfants"
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Une autre partie de notre priorité consiste à ajouter une protection pour les enfants lors de l'utilisation d'Internet. Nous encourageons les parents et les tuteurs à observer, participer et / ou surveiller et guider leur activité en ligne."
          ]
        },
        {
          "kind": "p",
          "parts": [
            "Mawareeth.com ne collecte sciemment aucune information personnelle identifiable d'enfants de moins de 13 ans. Si vous pensez que votre enfant a fourni ce type d'informations sur notre site Web, nous vous encourageons fortement à nous contacter immédiatement et nous ferons de notre mieux pour supprimer rapidement ces informations de nos dossiers."
          ]
        }
      ]
    },
  },
};
