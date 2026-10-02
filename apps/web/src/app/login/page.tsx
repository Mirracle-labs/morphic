import LoginView from './login-view';

export default function LoginPage() {
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  const githubConfigured = Boolean(
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
  );

  return (
    <LoginView googleConfigured={googleConfigured} githubConfigured={githubConfigured} />
  );
}
