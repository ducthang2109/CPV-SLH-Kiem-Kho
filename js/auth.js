// Cấu hình (mặc định + phần sửa trong app) và đăng nhập.
const Config = (function () {
  const KEY = 'kk_config';
  let cache;
  function get() {
    if (cache) return cache;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* bỏ qua */ }
    const d = window.APP_DEFAULT_CONFIG;
    cache = Object.assign({}, d, saved, {
      msal: Object.assign({}, d.msal, saved.msal),
      oneDrive: Object.assign({}, d.oneDrive, saved.oneDrive)
    });
    cache.localUsers = cache.localUsers || [];
    return cache;
  }
  function save(patch) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* bỏ qua */ }
    Object.assign(saved, patch);
    localStorage.setItem(KEY, JSON.stringify(saved));
    cache = null;
    return get();
  }
  return { get, save };
})();

// Ảnh bìa mặc định của từng nhà máy (lưu riêng trên máy vì ảnh lớn)
const Covers = {
  get: code => { try { return localStorage.getItem('kk_cover_' + code); } catch (e) { return null; } },
  set: (code, data) => {
    try {
      if (data) localStorage.setItem('kk_cover_' + code, data); else localStorage.removeItem('kk_cover_' + code);
    } catch (e) { throw new Error('Ảnh quá lớn, không lưu được trên máy'); }
  }
};

// Logo đầu trang báo cáo (lưu trên máy, chọn trong Cài đặt)
const Branding = {
  logo: () => { try { return localStorage.getItem('kk_logo'); } catch (e) { return null; } },
  setLogo: data => {
    try {
      if (data) localStorage.setItem('kk_logo', data); else localStorage.removeItem('kk_logo');
    } catch (e) { throw new Error('Logo quá lớn, không lưu được trên máy'); }
  }
};

const Auth = (function () {
  const USER_KEY = 'kk_user';
  let msalApp = null;

  const useMicrosoft = () => !!Config.get().msal.clientId && typeof msal !== 'undefined';

  function domainAllowed(email) {
    const domains = (Config.get().allowedDomains || []).filter(Boolean);
    if (!domains.length) return true;
    const d = String(email).split('@')[1] || '';
    return domains.some(x => d.toLowerCase() === x.toLowerCase());
  }

  async function init() {
    if (!useMicrosoft()) return;
    const c = Config.get().msal;
    msalApp = new msal.PublicClientApplication({
      auth: {
        clientId: c.clientId,
        authority: 'https://login.microsoftonline.com/' + (c.tenantId || 'organizations'),
        redirectUri: location.origin + location.pathname
      },
      cache: { cacheLocation: 'localStorage' }
    });
    await msalApp.initialize();
    try {
      const res = await msalApp.handleRedirectPromise();
      if (res && res.account) setMsUser(res.account);
    } catch (e) {
      console.warn('MSAL redirect', e);
    }
  }

  function setMsUser(account) {
    if (!domainAllowed(account.username)) {
      throw new Error('Tài khoản ' + account.username + ' không thuộc công ty');
    }
    msalApp.setActiveAccount(account);
    setUser({ email: account.username, name: account.name || account.username, provider: 'microsoft' });
  }

  function setUser(u) {
    u.loginAt = new Date().toISOString();
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  }

  function currentUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (e) { return null; }
  }

  async function loginMicrosoft() {
    if (!navigator.onLine) throw new Error('Cần có mạng cho lần đăng nhập Microsoft đầu tiên');
    await msalApp.loginRedirect({ scopes: Config.get().msal.scopes, prompt: 'select_account' });
  }

  async function loginLocal(email, password) {
    email = String(email).trim().toLowerCase();
    const u = Config.get().localUsers.find(x => x.email === email);
    if (!u || u.hash !== await Util.sha256(email + '|' + password)) throw new Error('Sai email hoặc mật khẩu');
    setUser({ email, name: u.name, provider: 'local', admin: !!u.admin });
  }

  async function addLocalUser(email, name, password, admin) {
    email = String(email).trim().toLowerCase();
    if (!email || !password) throw new Error('Nhập đủ email và mật khẩu');
    if (!domainAllowed(email)) throw new Error('Email phải thuộc tên miền công ty: ' + Config.get().allowedDomains.join(', '));
    const users = Config.get().localUsers.filter(x => x.email !== email);
    users.push({ email, name: name || email, admin: !!admin, hash: await Util.sha256(email + '|' + password) });
    Config.save({ localUsers: users });
  }

  function removeLocalUser(email) {
    Config.save({ localUsers: Config.get().localUsers.filter(x => x.email !== email) });
  }

  function logout() {
    localStorage.removeItem(USER_KEY);
    if (msalApp && navigator.onLine) {
      const acc = msalApp.getActiveAccount();
      if (acc) msalApp.logoutRedirect({ account: acc, postLogoutRedirectUri: location.origin + location.pathname });
    }
  }

  async function getToken() {
    if (!msalApp) throw new Error('Chưa cấu hình đăng nhập Microsoft (Cài đặt > Client ID)');
    const account = msalApp.getActiveAccount() || msalApp.getAllAccounts()[0];
    if (!account) { await loginMicrosoft(); return null; }
    const req = { scopes: Config.get().msal.scopes, account };
    try {
      return (await msalApp.acquireTokenSilent(req)).accessToken;
    } catch (e) {
      await msalApp.acquireTokenRedirect(req);
      return null;
    }
  }

  return { init, useMicrosoft, currentUser, loginMicrosoft, loginLocal, addLocalUser, removeLocalUser, logout, getToken, domainAllowed };
})();
