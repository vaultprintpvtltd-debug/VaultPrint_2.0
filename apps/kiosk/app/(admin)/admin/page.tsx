export default function AdminDashboardPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
          Fleet Dashboard
        </h1>
        <p className="mt-2 text-zinc-500 dark:text-zinc-400">
          Admin panel — protected by Supabase Auth middleware.
        </p>
      </div>
    </div>
  )
}
