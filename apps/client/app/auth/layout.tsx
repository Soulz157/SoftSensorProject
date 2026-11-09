// Each auth page renders its own <AuthShell> (title differs per page); the
// logo inside it links home, so the group needs no extra chrome.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
