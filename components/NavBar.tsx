'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navGroups = [
  {
    title: 'Main',
    items: [
      ['Home', '/'],
      ['Agenda', '/agenda'],
      ['Attendees', '/attendees'],
      ['Nearby', '/nearby'],
      ['Announcements', '/announcements'],
      ['Map', '/map'],
    ],
  },
  {
    title: 'Admin',
    items: [
      ['Import CSV', '/admin/imports'],
      ['Parking Admin', '/admin/parking'],
    ],
  },
] as const

export default function NavBar() {
  const pathname = usePathname()

  return (
    <nav>
      {navGroups.map((group) => (
        <div key={group.title}>
          <div className="nav-group-title">{group.title}</div>
          {group.items.map(([label, href]) => (
<Link key={href} href={href as any} className={pathname === href ? 'active' : ''}>              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  )
}
