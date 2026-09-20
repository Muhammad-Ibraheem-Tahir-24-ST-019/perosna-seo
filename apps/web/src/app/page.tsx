import { redirect } from 'next/navigation';

export default function RootPage() {
  // Middleware already routes unauthenticated visitors to /login.
  redirect('/dashboard');
}
