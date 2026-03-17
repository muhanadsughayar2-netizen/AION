window.SnapToAIGeminiAuth = (function() {
  const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview';
  const TOKEN_MAX_AGE = 50 * 60 * 1000;
  const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/generative-language';

  let refreshInFlight = null;

  async function getOAuthToken() {
    const result = await chrome.storage.local.get(['snaptoai_oauth_token', 'snaptoai_oauth_token_time', 'snaptoai_user']);
    if (!result.snaptoai_oauth_token || !result.snaptoai_user) return null;

    const age = Date.now() - (result.snaptoai_oauth_token_time || 0);
    if (age > TOKEN_MAX_AGE) {
      const refreshed = await deduplicatedRefresh();
      if (refreshed) return refreshed;
      return null;
    }

    const valid = await validateToken(result.snaptoai_oauth_token);
    if (!valid) {
      const refreshed = await deduplicatedRefresh();
      if (refreshed) return refreshed;
      return null;
    }

    return result.snaptoai_oauth_token;
  }

  async function validateToken(token) {
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + token);
      if (!resp.ok) return false;
      const info = await resp.json();
      if (!info.scope) return false;
      return info.scope.includes('generative-language');
    } catch (e) {
      return false;
    }
  }

  async function deduplicatedRefresh() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = refreshOAuthToken().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  async function refreshOAuthToken() {
    try {
      const clientId = chrome.runtime.getManifest().oauth2.client_id;
      const redirectUrl = chrome.identity.getRedirectURL();
      const scopes = 'openid email profile ' + REQUIRED_SCOPE;
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
        '?client_id=' + encodeURIComponent(clientId) +
        '&response_type=token' +
        '&redirect_uri=' + encodeURIComponent(redirectUrl) +
        '&scope=' + encodeURIComponent(scopes) +
        '&prompt=none';

      const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: false }, (url) => {
          if (chrome.runtime.lastError || !url) {
            reject(new Error(chrome.runtime.lastError?.message || 'Silent refresh failed'));
          } else {
            resolve(url);
          }
        });
      });

      const tokenMatch = responseUrl.match(/access_token=([^&]+)/);
      if (!tokenMatch) return null;

      const newToken = tokenMatch[1];
      await chrome.storage.local.set({
        snaptoai_oauth_token: newToken,
        snaptoai_oauth_token_time: Date.now()
      });
      console.log('[SnapToAI] OAuth token refreshed silently');
      return newToken;
    } catch (e) {
      console.log('[SnapToAI] Silent token refresh failed:', e.message);
      return null;
    }
  }

  async function interactiveReauth() {
    try {
      const clientId = chrome.runtime.getManifest().oauth2.client_id;
      const redirectUrl = chrome.identity.getRedirectURL();
      const scopes = 'openid email profile ' + REQUIRED_SCOPE;
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
        '?client_id=' + encodeURIComponent(clientId) +
        '&response_type=token' +
        '&redirect_uri=' + encodeURIComponent(redirectUrl) +
        '&scope=' + encodeURIComponent(scopes) +
        '&prompt=consent';

      const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
          if (chrome.runtime.lastError || !url) {
            reject(new Error(chrome.runtime.lastError?.message || 'Re-auth failed'));
          } else {
            resolve(url);
          }
        });
      });

      const tokenMatch = responseUrl.match(/access_token=([^&]+)/);
      if (!tokenMatch) return null;

      const newToken = tokenMatch[1];
      await chrome.storage.local.set({
        snaptoai_oauth_token: newToken,
        snaptoai_oauth_token_time: Date.now()
      });
      console.log('[SnapToAI] OAuth re-auth completed with full scopes');
      return newToken;
    } catch (e) {
      console.log('[SnapToAI] Interactive re-auth failed:', e.message);
      return null;
    }
  }

  async function getCredential() {
    const oauthToken = await getOAuthToken();
    if (oauthToken) {
      return {
        type: 'oauth',
        token: oauthToken,
        makeUrl: function(action) {
          return GEMINI_BASE + ':' + (action || 'generateContent');
        },
        makeStreamUrl: function() {
          return GEMINI_BASE + ':streamGenerateContent?alt=sse';
        },
        makeHeaders: function() {
          return {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + oauthToken
          };
        }
      };
    }

    const keyResult = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = keyResult.geminiApiKey;
    if (apiKey) {
      return {
        type: 'apikey',
        token: apiKey,
        makeUrl: function(action) {
          return GEMINI_BASE + ':' + (action || 'generateContent') + '?key=' + apiKey;
        },
        makeStreamUrl: function() {
          return GEMINI_BASE + ':streamGenerateContent?alt=sse&key=' + apiKey;
        },
        makeHeaders: function() {
          return { 'Content-Type': 'application/json' };
        }
      };
    }

    return null;
  }

  async function hasAnyCredential() {
    const oauth = await chrome.storage.local.get(['snaptoai_oauth_token', 'snaptoai_user']);
    if (oauth.snaptoai_oauth_token && oauth.snaptoai_user) return true;
    const key = await chrome.storage.sync.get(['geminiApiKey']);
    return !!(key.geminiApiKey && key.geminiApiKey.length > 10);
  }

  return {
    getCredential: getCredential,
    hasAnyCredential: hasAnyCredential,
    refreshOAuthToken: refreshOAuthToken,
    interactiveReauth: interactiveReauth
  };
})();
