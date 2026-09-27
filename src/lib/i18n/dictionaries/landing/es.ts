import type { landingEn } from "./en";

export const landingEs: typeof landingEn = {
  nav: { features: "Funciones", how: "Cómo funciona", pricing: "Precios", faq: "Preguntas", login: "Iniciar sesión", cta: "Prueba gratis" },
  hero: {
    badge: "Diseñado para las reglas de dropshipping de eBay 2026",
    title1: "Deja de publicar productos",
    title2: "que pierden dinero.",
    subtitle:
      "{brand} compara cada producto con la demanda real en eBay y con el coste entregado en AliExpress y CJ, y solo te deja publicar los que dejan más de un 30 % de margen tras comisiones. Publica los anuncios y hace los pedidos a los proveedores por ti.",
    cta: "Empieza tu prueba gratuita de 7 días",
    secondary: "Prueba la calculadora de beneficios gratis",
    reassurance: "Cuenta gratuita · 7 días de prueba gratis · Cancela cuando quieras · Nunca productos de Amazon ni Walmart",
  },
  mock: {
    title: "Análisis del producto",
    product: "Abrelatas eléctrico",
    market: "Precio de mercado eBay EE. UU.",
    cost: "Coste del proveedor entregado",
    fees: "Comisiones de eBay",
    profit: "Tu beneficio",
    verdict: "Rentable – listo para publicar",
    rejected: "Fuente de agua para gatos",
    rejectedNote: "Pierde 18,35 $ por venta – descartado",
    caption: "Cifras reales de nuestra prueba de septiembre de 2026",
  },
  proof: {
    title: "Lo probamos con productos reales antes de construirlo",
    items: [
      { value: "19 → 4", label: "productos probados vs. conservados: la mayoría de los \"productos ganadores\" pierden dinero tras comisiones" },
      { value: "9", label: "mercados de eBay: US, CA, UK, AU, DE, FR, IT, ES, IE" },
      { value: "100 %", label: "API oficial de eBay: sin scraping ni bots en tu cuenta" },
      { value: "5", label: "idiomas: inglés, francés, alemán, italiano, español" },
    ],
  },
  problem: {
    title: "Por qué la mayoría de los dropshippers de eBay abandonan en 90 días",
    items: [
      { title: "Fuentes prohibidas", text: "Comprar en Amazon o Walmart y enviarlo directamente al comprador infringe las normas de eBay. Las cuentas se marcan y se restringen." },
      { title: "Las comisiones se comen el margen", text: "Comisión por venta + cargo por pedido + publicidad. Un producto que parece dejar 10 $ a menudo deja 2 $, o pierde dinero." },
      { title: "Horas de trabajo manual", text: "Copiar títulos, revisar stock, hacer pedidos, pegar números de seguimiento. Todos los días." },
    ],
  },
  how: {
    title: "De cero a tu primer anuncio rentable en minutos",
    steps: [
      { title: "Conecta eBay", text: "Inicio de sesión seguro con la API oficial de eBay. Nunca vemos tu contraseña." },
      { title: "Encuentra ganadores", text: "Escribe un producto. Comparamos la demanda real en eBay con los precios de AliExpress y CJ en almacenes locales." },
      { title: "Publica en un clic", text: "La IA redacta el título y la descripción en el idioma de tus compradores, a un precio que protege tu margen." },
      { title: "Pedidos en piloto automático", text: "Cuando vendes, pedimos al proveedor y enviamos el número de seguimiento a eBay." },
    ],
  },
  features: {
    title: "Todo lo que necesitas para vender con seguridad y rentabilidad",
    items: [
      { title: "Filtro de margen del 30 %", text: "Cada producto se comprueba tras comisiones de eBay, impuestos y envío. Si está por debajo de tu umbral, nunca se sugiere." },
      { title: "Precios ponderados por ventas reales", text: "Los anuncios que venden de verdad cuentan más. Los anuncios caros que no venden no engañan a la herramienta." },
      { title: "Protección de la cuenta", text: "Límites diarios de publicación según la antigüedad de la cuenta, filtro de marcas VeRO y reglas de entrega rápida que no se pueden saltar." },
      { title: "Pedidos automáticos", text: "Pedidos a proveedores mediante las API oficiales de CJ y AliExpress, con seguimiento enviado automáticamente." },
      { title: "Control de stock y precios", text: "¿Sin stock o margen por debajo de tu umbral? El anuncio se pausa antes de que pierdas dinero." },
      { title: "9 países, 5 idiomas", text: "Vende en eBay EE. UU., Canadá, Reino Unido, Australia, Alemania, Francia, Italia, España e Irlanda." },
    ],
  },
  compare: {
    title: "Diseñado de forma distinta a las herramientas de dropshipping habituales",
    colTypical: "Herramientas habituales",
    colUs: "{brand}",
    rows: [
      { label: "Productos de Amazon / Walmart", typical: "A menudo", us: "Nunca" },
      { label: "Margen real tras todas las comisiones", typical: "Rara vez", us: "Siempre" },
      { label: "Demanda ponderada por ventas reales", typical: "No", us: "Sí" },
      { label: "Límites de publicación según antigüedad", typical: "Opcionales o \"modo agresivo\"", us: "Integrados" },
      { label: "Países e idiomas", typical: "Casi solo EE. UU., inglés", us: "9 países, 5 idiomas" },
    ],
  },
  pricing: {
    title: "Precios sencillos. Empieza gratis durante 7 días.",
    subtitle: "Paga anualmente y ahorra un 25 %. Cancela cuando quieras desde tu cuenta.",
    popular: "El más elegido",
    taglines: { STARTER: "Prueba tus primeros productos", PRO: "Para vendedores en crecimiento", BUSINESS: "Varias tiendas, sin límites", AGENCY: "Para agencias y equipos" },
    cta: "Prueba gratis",
  },
  faq: {
    title: "Preguntas frecuentes",
    items: [
      { q: "¿Está permitido el dropshipping en eBay?", a: "Sí, con un proveedor que te vende al por mayor y envía a tu comprador. Lo que eBay prohíbe es comprar el artículo a otro minorista (como Amazon o Walmart) y que se envíe directamente a tu comprador. {brand} solo trabaja con proveedores que cumplen las normas de eBay." },
      { q: "¿Qué proveedores admitís?", a: "CJDropshipping y AliExpress, con productos en almacenes locales para una entrega rápida. La herramienta elige siempre el coste entregado más bajo que respeta tu margen." },
      { q: "¿De dónde salen los precios?", a: "De la API oficial de eBay: precios de anuncios activos de productos nuevos, ponderados por el número estimado de unidades vendidas. No hacemos scraping de eBay." },
      { q: "¿Necesito una empresa registrada?", a: "Necesitas una cuenta de vendedor de eBay y una cuenta de proveedor. En Europa se aplican las comisiones de vendedor profesional y normalmente se exige estar dado de alta como empresa o autónomo." },
      { q: "¿Puedo cancelar cuando quiera?", a: "Sí. Gestionas tu suscripción desde tu cuenta, en dos clics. La prueba de 7 días es gratuita." },
      { q: "¿El beneficio está garantizado?", a: "Ninguna herramienta puede garantizar beneficios. {brand} te muestra las cifras reales antes de publicar y retira los productos que dejan de ser rentables, para que decidas con datos." },
    ],
  },
  finalCta: {
    title: "Tu próximo producto rentable está a una búsqueda.",
    text: "Regístrate ahora y obtén tu primer análisis en menos de cinco minutos.",
    cta: "Empieza tu prueba gratuita de 7 días",
  },
  footer: {
    product: "Producto",
    resources: "Recursos",
    calculator: "Calculadora de beneficios de eBay",
    affiliate: "Programa de afiliados (30 %)",
    contact: "Contacto",
    rights: "© {year} {company}. Todos los derechos reservados.",
    disclaimer: "{brand} es una herramienta independiente y no está afiliada, respaldada ni patrocinada por eBay Inc. eBay es una marca de eBay Inc.",
  },
};
