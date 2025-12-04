import fetch from 'node-fetch';
import { urls } from '../utils/urls.js';
import { get } from '../utils/api-json.js';
import Customer from './Customer.js';
import fs from 'fs';
import path from 'path';

const GRAPHQL_URL = 'https://www.dominos.com/api/web-bff/graphql';

const LOGIN_MUTATION = `mutation Login($email: String!, $password: String!, $rememberMe: Boolean, $recaptcha: String) {
  login(
    loginInput: {email: $email, password: $password, rememberMe: $rememberMe}
    recaptcha: $recaptcha
  ) {
    customer {
      firstName
      lastName
      customerID
      loyalty {
        vestedPointBalance
        __typename
      }
      __typename
    }
    __typename
  }
}`;

// GraphQL mutation for refreshing token using refreshToken cookie
const REFRESH_TOKEN_MUTATION = `mutation RefreshToken {
  refreshToken {
    customer {
      customerID
      firstName
      lastName
      email
      __typename
    }
    __typename
  }
}`;

class Account {
    constructor(parameters={}) {
        this.email = parameters.email || '';
        this.password = parameters.password || '';
        this.customer = parameters.customer instanceof Customer ? parameters.customer : new Customer(parameters.customer || {});
        this.token = parameters.token || '';
        this.customerId = parameters.customerId || '';
        this.refreshToken = parameters.refreshToken || '';
        
        // If token provided, extract customerId from JWT payload
        if (this.token && !this.customerId) {
            this.#parseToken();
        }
    }

    #parseToken() {
        try {
            const parts = this.token.split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                if (payload.CustomerID) {
                    this.customerId = payload.CustomerID;
                }
                if (payload.Email) {
                    this.email = payload.Email;
                }
            }
        } catch (e) {
            // Token parsing failed, customerId must be provided separately
        }
    }

    /**
     * Set authentication from a browser session token.
     * 
     * Since Domino's login requires reCAPTCHA, you can:
     * 1. Log in via the browser at dominos.com
     * 2. Copy the accessToken cookie value (starts with "Bearer ")
     * 3. Pass it to this method
     * 
     * @param {string} token - The JWT token from the accessToken cookie (without "Bearer+" prefix)
     */
    setToken(token) {
        // Remove "Bearer " or "Bearer+" prefix if present
        this.token = token.replace(/^Bearer[\s+]?/i, '');
        this.#parseToken();
    }

    async #graphqlRequest(operationName, query, variables = {}, apiName = operationName) {
        const headers = {
            'Accept': '*/*',
            'Content-Type': 'application/json',
            'Origin': 'https://www.dominos.com',
            'Referer': 'https://www.dominos.com/',
            'x-dpz-api': apiName,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        // Include token as cookie for authenticated requests
        if (this.token) {
            headers['Cookie'] = `market=US; accessToken=Bearer+${this.token}`;
        }

        const response = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                operationName,
                query,
                variables
            })
        });

        // Extract cookies from response (particularly accessToken)
        const setCookies = response.headers.raw()['set-cookie'];
        if (setCookies) {
            const accessTokenCookie = setCookies.find(c => c.startsWith('accessToken='));
            if (accessTokenCookie) {
                const tokenMatch = accessTokenCookie.match(/accessToken=Bearer\+([^;]+)/);
                if (tokenMatch) {
                    this.token = tokenMatch[1];
                    this.#parseToken();
                }
            }
        }

        return await response.json();
    }

    /**
     * Attempt to login via the GraphQL API.
     * 
     * NOTE: This currently requires a reCAPTCHA token to succeed.
     * For most use cases, use setToken() with a browser-obtained token instead.
     * 
     * @param {string} recaptchaToken - Optional reCAPTCHA token from Google Enterprise
     */
    async login(recaptchaToken = null) {
        const variables = {
            email: this.email,
            password: this.password,
            rememberMe: false
        };

        if (recaptchaToken) {
            variables.recaptcha = recaptchaToken;
        }

        const response = await this.#graphqlRequest('Login', LOGIN_MUTATION, variables, 'Login');

        // Extract customer data from GraphQL response
        if (response.data?.login?.customer) {
            const customer = response.data.login.customer;
            this.customerId = customer.customerID;
            
            if (customer.firstName) this.customer.firstName = customer.firstName;
            if (customer.lastName) this.customer.lastName = customer.lastName;
            
            if (customer.loyalty) {
                this.loyaltyPoints = customer.loyalty.vestedPointBalance;
            }
        }
        
        return response;
    }

    /**
     * Refresh the access token using a refresh token.
     * The refresh token is a long-lived token (3 months) that can be used to get new access tokens.
     * 
     * @param {string} refreshTokenValue - The refresh token (base64 encoded JSON from cookie)
     * @returns {Promise<Object>} - The response from the refresh attempt
     */
    async refreshAccessToken(refreshTokenValue = null) {
        const tokenToUse = refreshTokenValue || this.refreshToken;
        
        if (!tokenToUse) {
            throw new Error('No refresh token available. Get it from the refreshToken cookie in your browser.');
        }

        // Store the refresh token for future use
        this.refreshToken = tokenToUse;

        const headers = {
            'Accept': '*/*',
            'Content-Type': 'application/json',
            'Origin': 'https://www.dominos.com',
            'Referer': 'https://www.dominos.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': `market=US; refreshToken=${tokenToUse}`
        };

        const response = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                operationName: 'RefreshToken',
                query: REFRESH_TOKEN_MUTATION,
                variables: {}
            })
        });

        // Extract new accessToken from response cookies
        const setCookies = response.headers.raw()['set-cookie'];
        if (setCookies) {
            const accessTokenCookie = setCookies.find(c => c.startsWith('accessToken='));
            if (accessTokenCookie) {
                const tokenMatch = accessTokenCookie.match(/accessToken=Bearer\+([^;]+)/);
                if (tokenMatch) {
                    this.token = tokenMatch[1];
                    this.#parseToken();
                    console.log('✅ Access token refreshed successfully!');
                }
            }
            
            // Also capture new refresh token if provided
            const newRefreshToken = setCookies.find(c => c.startsWith('refreshToken='));
            if (newRefreshToken) {
                const refreshMatch = newRefreshToken.match(/refreshToken=([^;]+)/);
                if (refreshMatch) {
                    this.refreshToken = refreshMatch[1];
                }
            }
        }

        const jsonResponse = await response.json();
        
        // Extract customer data if available
        if (jsonResponse.data?.refreshToken?.customer) {
            const customer = jsonResponse.data.refreshToken.customer;
            if (customer.customerID) this.customerId = customer.customerID;
            if (customer.email) this.email = customer.email;
            if (customer.firstName) this.customer.firstName = customer.firstName;
            if (customer.lastName) this.customer.lastName = customer.lastName;
        }

        return jsonResponse;
    }

    /**
     * Set the refresh token for automatic token refresh.
     * @param {string} refreshTokenValue - The refresh token from the browser cookie
     */
    setRefreshToken(refreshTokenValue) {
        this.refreshToken = refreshTokenValue;
    }

    /**
     * Ensure we have a valid access token, refreshing if necessary.
     * @returns {Promise<boolean>} - True if token is valid or was refreshed successfully
     */
    async ensureValidToken() {
        if (this.isTokenValid()) {
            return true;
        }

        if (!this.refreshToken) {
            console.warn('Token expired and no refresh token available');
            return false;
        }

        try {
            await this.refreshAccessToken();
            return this.isTokenValid();
        } catch (e) {
            console.error('Failed to refresh token:', e.message);
            return false;
        }
    }

    /**
     * Get loyalty points and available coupons using the Power API.
     * Requires authentication via token.
     */
    async getPoints() {
        if (!this.token || !this.customerId) {
            throw new Error('You must login first to get points.');
        }

        const url = urls.customer.loyalty.replace('${customerID}', this.customerId);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Referer': 'https://order.dominos.com/'
            }
        });

        return await response.json();
    }

    /**
     * Check if the current token is valid and not expired.
     */
    isTokenValid() {
        if (!this.token) return false;
        
        try {
            const parts = this.token.split('.');
            if (parts.length !== 3) return false;
            
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            if (!payload.exp) return false;
            
            // Check if token is expired (with 60 second buffer)
            return Date.now() < (payload.exp * 1000 - 60000);
        } catch (e) {
            return false;
        }
    }

    /**
     * Get token expiration time.
     */
    getTokenExpiration() {
        if (!this.token) return null;
        
        try {
            const parts = this.token.split('.');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            return payload.exp ? new Date(payload.exp * 1000) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Get time remaining until token expires in minutes.
     */
    getTokenMinutesRemaining() {
        const expiration = this.getTokenExpiration();
        if (!expiration) return 0;
        
        const remaining = expiration.getTime() - Date.now();
        return Math.max(0, Math.floor(remaining / 60000));
    }

    /**
     * Save token to a file for persistence across sessions.
     * @param {string} filePath - Path to save the token (default: .dominos-token)
     */
    saveToken(filePath = '.dominos-token') {
        if (!this.token && !this.refreshToken) {
            throw new Error('No token to save');
        }
        
        const data = {
            token: this.token,
            refreshToken: this.refreshToken,
            email: this.email,
            customerId: this.customerId,
            savedAt: new Date().toISOString(),
            expiresAt: this.getTokenExpiration()?.toISOString()
        };
        
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return filePath;
    }

    /**
     * Load token from a file.
     * @param {string} filePath - Path to load the token from (default: .dominos-token)
     * @returns {boolean} - True if token was loaded and is valid (or can be refreshed)
     */
    loadToken(filePath = '.dominos-token') {
        try {
            if (!fs.existsSync(filePath)) {
                return false;
            }
            
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            // Load refresh token if available
            if (data.refreshToken) {
                this.refreshToken = data.refreshToken;
            }
            
            if (data.token) {
                this.token = data.token;
                this.#parseToken();
                
                // Check if loaded token is still valid
                if (!this.isTokenValid()) {
                    console.warn('Loaded access token has expired');
                    // Still return true if we have a refresh token
                    return !!this.refreshToken;
                }
                
                return true;
            }
            
            // Return true if we at least have a refresh token
            return !!this.refreshToken;
        } catch (e) {
            return false;
        }
    }

    /**
     * Create an Account instance from environment variable or token file.
     * Checks DOMINOS_TOKEN and DOMINOS_REFRESH_TOKEN env vars first, 
     * then falls back to token file.
     * Will automatically refresh if access token is expired but refresh token is available.
     * 
     * @param {string} tokenFilePath - Path to token file (default: .dominos-token)
     * @returns {Promise<Account|null>} - Account instance if token found and valid, null otherwise
     */
    static async fromEnvironment(tokenFilePath = '.dominos-token') {
        const account = new Account();
        
        // Load tokens from environment variables first
        const envToken = process.env.DOMINOS_TOKEN;
        const envRefreshToken = process.env.DOMINOS_REFRESH_TOKEN;
        
        // Always try to load from file to get any saved tokens (especially refresh token)
        account.loadToken(tokenFilePath);
        
        // Environment variables override file values
        if (envToken) {
            account.token = envToken;
            account.#parseToken();
        }
        
        if (envRefreshToken) {
            account.refreshToken = envRefreshToken;
        }
        
        // If we have a valid access token, we're good
        if (account.isTokenValid()) {
            return account;
        }
        
        // Try to refresh if we have a refresh token
        if (account.refreshToken) {
            console.log('Access token expired, attempting refresh...');
            try {
                await account.refreshAccessToken();
                if (account.isTokenValid()) {
                    // Save the new token
                    account.saveToken(tokenFilePath);
                    return account;
                }
            } catch (e) {
                console.warn('Failed to refresh token:', e.message);
            }
        }
        
        return null;
    }

    /**
     * Synchronous version of fromEnvironment for backwards compatibility.
     * Does not attempt automatic refresh.
     * @deprecated Use async fromEnvironment() instead
     */
    static fromEnvironmentSync(tokenFilePath = '.dominos-token') {
        const account = new Account();
        
        // Always try to load from file first to get saved tokens
        account.loadToken(tokenFilePath);
        
        // Environment variables override file values
        const envToken = process.env.DOMINOS_TOKEN;
        const envRefreshToken = process.env.DOMINOS_REFRESH_TOKEN;
        
        if (envToken) {
            account.token = envToken;
            account.#parseToken();
        }
        
        if (envRefreshToken) {
            account.refreshToken = envRefreshToken;
        }
        
        if (account.isTokenValid()) {
            return account;
        }
        
        // Return account with refresh token even if access token is expired
        // Caller can then call refreshAccessToken() manually
        if (account.refreshToken) {
            return account;
        }
        
        return null;
    }

    /**
     * Get token status information for debugging/display.
     */
    getTokenStatus() {
        return {
            hasToken: !!this.token,
            hasRefreshToken: !!this.refreshToken,
            isValid: this.isTokenValid(),
            email: this.email,
            customerId: this.customerId,
            expiresAt: this.getTokenExpiration(),
            minutesRemaining: this.getTokenMinutesRemaining(),
            needsRefresh: this.getTokenMinutesRemaining() < 5
        };
    }

    /**
     * Get instructions for obtaining a new token from the browser.
     */
    static getTokenInstructions() {
        return `
To get a Domino's authentication token:

1. Open https://www.dominos.com in your browser
2. Log in to your account
3. Open Developer Tools (F12) → Application tab → Cookies
4. Find the 'accessToken' cookie
5. Copy the value (remove 'Bearer+' prefix if present)
6. Set it via:
   - Environment variable: export DOMINOS_TOKEN="your_token_here"
   - Or save to file: account.setToken("your_token"); account.saveToken();

Note: Tokens expire after ~1 hour. You'll need to refresh periodically.
`;
    }
}

export {
    Account as default,
    Account
}
