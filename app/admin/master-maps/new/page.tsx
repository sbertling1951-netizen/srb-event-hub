'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function NewMasterMapPage() {
  const router = useRouter()

  const [name, setName] = useState('')
  const [parkName, setParkName] = useState('')
  const [location, setLocation] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState('Fill in the form to create a new master map.')
  const [busy, setBusy] = useState(false)

  async function createMasterMap() {
    if (!name.trim()) {
      setStatus('Enter a master map name.')
      return
    }

    if (!file) {
      setStatus('Choose a PNG map image.')
      return
    }

    setBusy(true)
    setStatus('Creating master map...')

    const { data: created, error: createError } = await supabase
      .from('master_maps')
      .insert({
        name: name.trim(),
        park_name: parkName.trim() || null,
        location: location.trim() || null,
        status: 'draft',
        is_read_only: false,
      })
      .select('id')
      .single()

    if (createError || !created) {
      setBusy(false)
      setStatus(`Could not create master map: ${createError?.message || 'Unknown error'}`)
      return
    }

    const path = `${created.id}/base-map.png`

    const { error: uploadError } = await supabase.storage
      .from('master-map-images')
      .upload(path, file, {
        upsert: true,
        contentType: file.type || 'image/png',
      })

    if (uploadError) {
      setBusy(false)
      setStatus(`Master map created, but image upload failed: ${uploadError.message}`)
      return
    }

    const { data: publicUrlData } = supabase.storage
      .from('master-map-images')
      .getPublicUrl(path)

    const mapImageUrl = publicUrlData.publicUrl

    const { error: updateError } = await supabase
      .from('master_maps')
      .update({
        map_image_path: path,
        map_image_url: mapImageUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', created.id)

    if (updateError) {
      setBusy(false)
      setStatus(`Master map created, but metadata update failed: ${updateError.message}`)
      return
    }

    router.push(`/admin/master-maps/${created.id}`)
  }

  return (
    <div style={{ padding: 24, maxWidth: 700 }}>
      <h1>Create New Master Map</h1>
      <p>Upload the base PNG map first, then place site markers in the editor.</p>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 10,
          background: 'white',
          padding: 16,
          display: 'grid',
          gap: 12,
        }}
      >
        <input
          placeholder="Master map name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8 }}
        />

        <input
          placeholder="Park / campground name"
          value={parkName}
          onChange={(e) => setParkName(e.target.value)}
          style={{ padding: 8 }}
        />

        <input
          placeholder="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          style={{ padding: 8 }}
        />

        <div>
          <div style={{ marginBottom: 6, fontWeight: 700 }}>Upload PNG map</div>
          <input
            type="file"
            accept=".png,image/png"
            disabled={busy}
            onChange={(e) => {
              const selected = e.target.files?.[0] || null
              setFile(selected)
            }}
          />
        </div>

        <button disabled={busy} onClick={() => void createMasterMap()}>
          Create Master Map and Open Editor
        </button>
      </div>

      <p style={{ marginTop: 20 }}>
        <strong>Status:</strong> {status}
      </p>
    </div>
  )
}
