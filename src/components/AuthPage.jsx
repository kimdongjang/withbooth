import { useState } from 'react';
import Icon from './Icon';

const SUPPORT_EMAIL = 'gieunp3644@gmail.com';

function PrivacyConsent({ checked, onChange }) {
  return <div className="auth-privacy">
    <label className="auth-privacy-check"><input type="checkbox" name="signup-privacy-consent" required checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>[필수] 개인정보 수집·이용에 동의합니다.</span></label>
    <details className="auth-privacy-policy">
      <summary>개인정보 수집·이용 및 보관 정책 보기</summary>
      <dl>
        <div><dt>수집 항목</dt><dd>필수: 아이디, 이메일, 패스워드(암호화 저장) · 선택: 닉네임</dd></div>
        <div><dt>수집·이용 목적</dt><dd>회원 식별 및 가입 의사 확인, 계정 문의·패스워드 분실 등 본인 확인, 서비스 운영 관련 공지 전달</dd></div>
        <div><dt>보유·이용 기간</dt><dd>회원 탈퇴 시까지 보관하며, 탈퇴하면 이메일·닉네임·패스워드 정보를 지체 없이 파기합니다. 단, 관계 법령에서 보존을 정한 정보는 해당 기간 동안 보관합니다.</dd></div>
        <div><dt>파기 방법</dt><dd>전자적 파일 형태의 정보는 복구할 수 없는 방법으로 삭제합니다.</dd></div>
        <div><dt>동의 거부 권리</dt><dd>개인정보 수집·이용에 동의하지 않을 수 있으나, 동의하지 않으면 회원가입을 할 수 없습니다.</dd></div>
        <div><dt>문의</dt><dd><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></dd></div>
      </dl>
    </details>
  </div>;
}

function PasswordField({ id, label, value, onChange, signup }) {
  const [visible, setVisible] = useState(false);
  return <div className="mb-3">
    <label htmlFor={id} className="block text-sm font-bold">{label}</label>
    <div className="mt-1 relative">
      <input id={id} name={id} type={visible ? 'text' : 'password'} required minLength={signup ? 6 : undefined} autoComplete={signup ? 'new-password' : 'current-password'} value={value} onChange={(e) => onChange(e.target.value)} className="w-full min-w-0 rounded border border-line py-2 pl-2 pr-12 text-[13px]" />
      <button type="button" aria-controls={id} aria-pressed={visible} aria-label={`${label} ${visible ? '숨기기' : '보기'}`} title={visible ? '패스워드 숨기기' : '패스워드 보기'} onClick={() => setVisible(!visible)} className="password-toggle"><Icon name={visible ? 'eyeOff' : 'eye'} /></button>
    </div>
  </div>;
}

function AuthForm({ mode, onAuthenticate }) {
  const signup = mode === 'signup';
  const [id, setId] = useState('');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPasswordHelp, setShowPasswordHelp] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (signup && password !== confirmation) {
      setError('패스워드와 패스워드 확인이 일치하지 않습니다.');
      return;
    }
    if (signup && !privacyConsent) {
      setError('개인정보 수집·이용에 동의해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      await onAuthenticate({ mode, id, password, ...(signup ? { email, nickname, privacyConsent } : {}) });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };
  return <form onSubmit={submit} className="auth-card">
    <div className="auth-card-heading">
      <a href="#/login" className="brand-title" aria-label="위드부스 로그인"><img className="brand-logo" src="/brand/withbooth-final-logo.png" alt="위드부스" width="1930" height="815" /></a>
      <h1 className="sr-only">{signup ? '회원가입' : '로그인'}</h1>
      <p className="auth-card-description">{signup ? '새로운 부스의 시작을 함께해요.' : '행사별 상품과 판매 내역을 한곳에서 관리하세요.'}</p>
    </div>
    <fieldset disabled={submitting} className="min-w-0">
      <label className="mb-3 block text-sm font-bold">아이디<input name={`${mode}-username`} autoComplete="username" required autoFocus value={id} onChange={(e) => setId(e.target.value)} className="mt-1 w-full rounded border border-line p-1.5 text-[13px]" /></label>
      {signup && <label className="mb-3 block text-sm font-bold">이메일<input type="email" name="signup-email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded border border-line p-1.5 text-[13px]" /></label>}
      {signup && <label className="mb-3 block text-sm font-bold">닉네임 (선택)<input maxLength={30} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="비워두면 랜덤 닉네임을 만들어드려요" className="mt-1 w-full rounded border border-line p-1.5 text-[13px]" /></label>}
      <PasswordField id={`${mode}-password`} label="패스워드" signup={signup} value={password} onChange={setPassword} />
      {signup && <PasswordField id="signup-password-confirmation" label="패스워드 확인" signup value={confirmation} onChange={setConfirmation} />}
      {signup && <PrivacyConsent checked={privacyConsent} onChange={setPrivacyConsent} />}
      {error && <div role="alert" className="mb-3 rounded bg-danger px-3 py-2 text-xs text-white">{error}</div>}
      <button disabled={submitting} className="w-full rounded-lg bg-register px-4 py-3 font-bold text-white disabled:opacity-60">{submitting ? '처리 중…' : signup ? '회원가입하고 시작' : '로그인'}</button>
      {!signup && <div className="auth-password-help">
        <a href="#password-help" aria-expanded={showPasswordHelp} aria-controls="password-help" onClick={(event) => { event.preventDefault(); if (!submitting) setShowPasswordHelp(!showPasswordHelp); }} aria-disabled={submitting}>패스워드를 잊으셨나요?</a>
        <p id="password-help" hidden={!showPasswordHelp} role="status">패스워드를 잊으셨다면 아이디를 적어 <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('[위드부스] 패스워드 재설정 문의')}`}>{SUPPORT_EMAIL}</a>로 문의해주세요.</p>
      </div>}
      <div className="auth-switch">
        <p>{signup ? '이미 회원이신가요?' : '회원가입이 아직이라면'}</p>
        <a href={signup ? '#/login' : '#/signup'} className="auth-switch-button" aria-disabled={submitting} onClick={(event) => { if (submitting) event.preventDefault(); }}>{signup ? '로그인 하기' : '회원가입 하기'}</a>
      </div>
    </fieldset>
  </form>;
}

export default function AuthPage({ onAuthenticate, mode }) {
  // Remounting clears credentials, errors and password visibility on every switch.
  return <div className="auth-shell min-h-full flex flex-col bg-paper text-ink"><header className="auth-header border-b border-line bg-white"><a href="#/login" className="display-font brand-title font-bold"><img className="brand-logo" src="/brand/withbooth-final-logo.png" alt="위드부스" width="1930" height="815" /></a></header><main className="auth-main">
    <section className="auth-intro" aria-labelledby="auth-intro-title">
      <span className="auth-eyebrow">여러 제작자가 함께하는 굿즈 부스</span>
      <h2 id="auth-intro-title">함께 만드는 부스,<br /><span>판매 관리는 가볍게.</span></h2>
      <p className="auth-lead">행사별 상품과 판매 내역을<br className="auth-desktop-break" /> 한곳에서 관리하세요.</p>
      <div className="auth-benefits">
        <div><span className="auth-benefit-icon"><Icon name="log" /></span><div><h3>같이 팔고, 제작자별로 확인하세요.</h3><p>함께 운영하는 부스도 제작자별 판매금액을 한눈에.</p></div></div>
        <div><span className="auth-benefit-icon"><Icon name="settings" /></span><div><h3>첫 행사도 차근차근.</h3><p>이미지로 상품을 구분하고, 세트 판매와 남은 재고까지.</p></div></div>
        <div><span className="auth-benefit-icon"><Icon name="project" /></span><div><h3>다음 행사에도, 위드부스.</h3><p>내 상품은 여러 행사에 가져오고 판매 기록은 행사별로 관리하세요.</p></div></div>
      </div>
    </section>
    <AuthForm key={mode} mode={mode} onAuthenticate={onAuthenticate} />
  </main></div>;
}
