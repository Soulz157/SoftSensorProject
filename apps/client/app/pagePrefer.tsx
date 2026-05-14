// import Link from 'next/link'
// import {
//   Activity,
//   BarChart3,
//   Cpu,
//   Layers,
//   Plug,
//   Rocket,
//   TrendingUp,
//   Zap,
// } from 'lucide-react'
// import { Badge } from '@/components/ui/badge'
// import { Button } from '@/components/ui/button'
// import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// // ─── Navbar ───────────────────────────────────────────────────────────────────

// function Navbar() {
//   return (
//     <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
//       <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
//         <Link href="/" className="flex items-center gap-2">
//           <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground text-sm">
//             S
//           </div>
//           <span className="font-semibold text-foreground">SoftSensor</span>
//         </Link>

//         <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
//           <a
//             href="#features"
//             className="transition-colors hover:text-foreground"
//           >
//             Features
//           </a>
//           <a
//             href="#how-it-works"
//             className="transition-colors hover:text-foreground"
//           >
//             How It Works
//           </a>
//         </nav>

//         <div className="flex items-center gap-2">
//           <Button variant="ghost" size="sm" asChild>
//             <Link href="/login">Log in</Link>
//           </Button>
//           <Button size="sm" asChild>
//             <Link href="/register">Get Started</Link>
//           </Button>
//         </div>
//       </div>
//     </header>
//   )
// }

// // ─── Hero ─────────────────────────────────────────────────────────────────────

// function HeroSection() {
//   return (
//     <section className="relative flex flex-col items-center justify-center overflow-hidden px-4 py-24 text-center md:py-36">
//       <div
//         className="absolute inset-0 -z-10"
//         style={{
//           background:
//             'radial-gradient(ellipse 80% 50% at 50% -20%, oklch(0.55 0.18 250 / 0.12), transparent)',
//         }}
//       />
//       <Badge variant="secondary" className="mb-6">
//         <Zap className="mr-1 h-3 w-3" />
//         Now in Beta — Early Access Available
//       </Badge>
//       <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl">
//         Monitor Smarter with <span className="text-primary">AI-Powered</span>{' '}
//         Soft Sensors
//       </h1>
//       <p className="mt-6 max-w-xl text-lg text-muted-foreground">
//         Connect industrial sensors, deploy machine learning models, and gain
//         real-time insights — all from one unified platform.
//       </p>
//       <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
//         <Button size="lg" asChild>
//           <Link href="/register">Get Started Free</Link>
//         </Button>
//         <Button size="lg" variant="outline" asChild>
//           <a href="#features">Explore Features</a>
//         </Button>
//       </div>
//     </section>
//   )
// }

// // ─── Features ─────────────────────────────────────────────────────────────────

// const FEATURES = [
//   {
//     icon: Activity,
//     title: 'Real-time Monitoring',
//     description:
//       'Stream live sensor data with millisecond latency. Set thresholds and receive instant alerts when anomalies occur.',
//   },
//   {
//     icon: Cpu,
//     title: 'AI Model Integration',
//     description:
//       'Import and deploy soft sensor models trained on your data. Supports ONNX, TensorFlow, and custom Python models.',
//   },
//   {
//     icon: BarChart3,
//     title: 'Analytics Dashboard',
//     description:
//       'Visualize historical trends, correlations, and forecasts. Export reports with one click.',
//   },
//   {
//     icon: Layers,
//     title: 'Multi-workspace',
//     description:
//       'Organize projects by team, site, or process. Fine-grained access control for every workspace.',
//   },
// ] as const

// function FeaturesSection() {
//   return (
//     <section id="features" className="px-4 py-20">
//       <div className="mx-auto max-w-6xl">
//         <div className="mb-12 text-center">
//           <h2 className="text-3xl font-bold text-foreground">
//             Everything you need to operate at scale
//           </h2>
//           <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
//             Built for process engineers, data scientists, and operations teams
//             who demand reliability.
//           </p>
//         </div>
//         <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
//           {FEATURES.map(({ icon: Icon, title, description }) => (
//             <Card
//               key={title}
//               className="border-border/60 bg-card transition-colors hover:border-primary/40"
//             >
//               <CardHeader className="pb-3">
//                 <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
//                   <Icon className="h-5 w-5" />
//                 </div>
//                 <CardTitle className="text-base">{title}</CardTitle>
//               </CardHeader>
//               <CardContent>
//                 <p className="text-sm text-muted-foreground">{description}</p>
//               </CardContent>
//             </Card>
//           ))}
//         </div>
//       </div>
//     </section>
//   )
// }

// // ─── How It Works ─────────────────────────────────────────────────────────────

// const STEPS = [
//   {
//     icon: Plug,
//     step: '01',
//     title: 'Connect Your Sensors',
//     description:
//       'Import data via REST, MQTT, or CSV upload. Our connectors support OPC-UA and Modbus out of the box.',
//   },
//   {
//     icon: Rocket,
//     step: '02',
//     title: 'Deploy AI Models',
//     description:
//       'Upload your trained model or use our AutoML pipeline to build one from historical sensor data.',
//   },
//   {
//     icon: TrendingUp,
//     step: '03',
//     title: 'Monitor & Analyze',
//     description:
//       'Watch predictions in real-time, drill into anomalies, and improve model accuracy over time.',
//   },
// ] as const

// function HowItWorksSection() {
//   return (
//     <section id="how-it-works" className="bg-muted/40 px-4 py-20">
//       <div className="mx-auto max-w-6xl">
//         <div className="mb-12 text-center">
//           <h2 className="text-3xl font-bold text-foreground">
//             Up and running in minutes
//           </h2>
//           <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
//             No complex setup. No infrastructure headaches.
//           </p>
//         </div>
//         <div className="grid gap-8 md:grid-cols-3">
//           {STEPS.map(({ icon: Icon, step, title, description }) => (
//             <div key={step} className="flex flex-col items-start gap-4">
//               <div className="flex items-center gap-3">
//                 <span className="text-4xl font-black text-primary/20">
//                   {step}
//                 </span>
//                 <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
//                   <Icon className="h-5 w-5" />
//                 </div>
//               </div>
//               <div>
//                 <h3 className="mb-1 font-semibold text-foreground">{title}</h3>
//                 <p className="text-sm text-muted-foreground">{description}</p>
//               </div>
//             </div>
//           ))}
//         </div>
//       </div>
//     </section>
//   )
// }

// // ─── CTA Banner ───────────────────────────────────────────────────────────────

// function CTABanner() {
//   return (
//     <section className="px-4 py-20">
//       <div className="mx-auto max-w-3xl text-center">
//         <h2 className="text-3xl font-bold text-foreground">
//           Start monitoring today
//         </h2>
//         <p className="mt-4 text-muted-foreground">
//           Free during beta. No credit card required. Cancel anytime.
//         </p>
//         <div className="mt-8 flex flex-wrap justify-center gap-4">
//           <Button size="lg" asChild>
//             <Link href="/register">Create Free Account</Link>
//           </Button>
//           <Button size="lg" variant="outline" asChild>
//             <Link href="/login">Sign In</Link>
//           </Button>
//         </div>
//       </div>
//     </section>
//   )
// }

// // ─── Footer ───────────────────────────────────────────────────────────────────

// function Footer() {
//   return (
//     <footer className="border-t border-border px-4 py-10">
//       <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 md:flex-row md:justify-between">
//         <Link href="/" className="flex items-center gap-2">
//           <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground text-xs">
//             S
//           </div>
//           <span className="text-sm font-semibold text-foreground">
//             SoftSensor
//           </span>
//         </Link>
//         <div className="flex items-center gap-6 text-xs text-muted-foreground">
//           <a
//             href="#features"
//             className="transition-colors hover:text-foreground"
//           >
//             Features
//           </a>
//           <a
//             href="#how-it-works"
//             className="transition-colors hover:text-foreground"
//           >
//             How It Works
//           </a>
//           <Link
//             href="/login"
//             className="transition-colors hover:text-foreground"
//           >
//             Login
//           </Link>
//           <Link
//             href="/register"
//             className="transition-colors hover:text-foreground"
//           >
//             Register
//           </Link>
//         </div>
//         <p className="text-xs text-muted-foreground">
//           © {new Date().getFullYear()} SoftSensor. All rights reserved.
//         </p>
//       </div>
//     </footer>
//   )
// }

// // ─── Page ─────────────────────────────────────────────────────────────────────

// export default function LandingPage() {
//   return (
//     <div className="min-h-screen bg-background text-foreground">
//       <Navbar />
//       <main>
//         <HeroSection />
//         <FeaturesSection />
//         <HowItWorksSection />
//         <CTABanner />
//       </main>
//       <Footer />
//     </div>
//   )
// }
