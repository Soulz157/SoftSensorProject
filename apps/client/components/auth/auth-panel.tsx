import Link from 'next/link'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function AuthPanel() {
  return (
    <div className="flex-1 flex flex-col items-center w-full h-full justify-center relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-150 h-150 bg-blue-600/5 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="relative mb-6">
        <div
          className="text-[120px] leading-none animate-bounce"
          style={{ filter: 'drop-shadow(0 20px 30px rgba(37, 99, 235, 0.4))' }}
        >
          🚀
        </div>
      </div>

      <h1 className="text-8xl md:text-[120px] font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-500 tracking-tighter uppercase select-none mb-6 text-center leading-none">
        LOGIN
      </h1>

      <p className="text-zinc-400 text-lg mb-10 max-w-md text-center">
        Welcome back to the SoftSensor platform. <br /> Please log in to manage
        your workspaces.
      </p>

      <Button className="group relative  cursor-pointer flex items-center gap-3 w-40 h-12 px-8 py-4 bg-white hover:bg-zinc-200 text-black rounded-full font-bold text-lg transition-all hover:scale-105 active:scale-95 shadow-[0_0_40px_rgba(255,255,255,0.1)]">
        <LogIn
          size={24}
          className="group-hover:translate-x-1 transition-transform"
        />
        <Link href="/login">continue</Link>
      </Button>
    </div>
  )
}
