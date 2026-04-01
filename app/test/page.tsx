'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function TestPage() {
  const [message, setMessage] = useState('Testing connection...')

  useEffect(() => {
    async function testConnection() {
      const { data, error } = await supabase
        .from('test_connection')
        .select('*')

      if (error) {
        console.error('Supabase error:', error)
        setMessage(`❌ ${error.message}`)
      } else {
        setMessage(`✅ Connected. Rows returned: ${data?.length ?? 0}`)
      }
    }

    testConnection()
  }, [])

  return (
    <div style={{ padding: 40 }}>
      <h1>Supabase Test</h1>
      <p>{message}</p>
    </div>
  )
}