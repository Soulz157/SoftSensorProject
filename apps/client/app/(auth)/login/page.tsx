'use client'
// import dynamic from 'next/dynamic'
import LoginClient from './components/login'

// const LoginClient = dynamic(() => import('./components/login'), { ssr: false })

export default function Page() {
  return <LoginClient />
}
