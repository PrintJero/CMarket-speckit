export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="auth-shell">
      <div className="auth-shell__blob auth-shell__blob--one" aria-hidden="true" />
      <div className="auth-shell__blob auth-shell__blob--two" aria-hidden="true" />
      <div className="auth-shell__wordmark">CMarket</div>
      <div className="card">{children}</div>
    </div>
  );
}
