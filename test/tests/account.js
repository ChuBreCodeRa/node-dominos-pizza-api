import {Account} from '../../index.js';
import {Customer} from '../../index.js';
import IsDominos from '../../utils/DominosTypes.js';

const isDominos=new IsDominos;

const runTest=async function(test){
    // Test 1: Initialization
    try{
        test.expects(`Account to initialize properly`);    
        const account = new Account({
            email: 'test@example.com',
            password: 'password123',
            customer: {
                firstName: 'John',
                lastName: 'Doe',
                email: 'test@example.com'
            }
        });
        
        if(account.email !== 'test@example.com') test.fail();
        if(account.password !== 'password123') test.fail();
        isDominos.customer(account.customer);
        
    }catch(err){
        console.trace(err);
        test.fail();
    }
    test.pass();
    test.done();

    // Test 2: Token initialization and parsing
    try{
        test.expects(`Account to parse JWT token and extract customer info`);    
        // Sample JWT structure (not a real token, just for testing parsing)
        const samplePayload = {
            CustomerID: 'test-customer-123',
            Email: 'parsed@example.com',
            exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
        };
        const encodedPayload = Buffer.from(JSON.stringify(samplePayload)).toString('base64');
        const fakeToken = `header.${encodedPayload}.signature`;
        
        const account = new Account({ token: fakeToken });
        
        if(account.customerId !== 'test-customer-123') test.fail();
        if(account.email !== 'parsed@example.com') test.fail();
        if(!account.isTokenValid()) test.fail();
        
    }catch(err){
        console.trace(err);
        test.fail();
    }
    test.pass();
    test.done();

    // Test 3: setToken method
    try{
        test.expects(`Account.setToken to handle Bearer+ prefix`);    
        const account = new Account();
        
        const samplePayload = {
            CustomerID: 'settoken-test-456',
            Email: 'settoken@example.com',
            exp: Math.floor(Date.now() / 1000) + 3600
        };
        const encodedPayload = Buffer.from(JSON.stringify(samplePayload)).toString('base64');
        const fakeToken = `header.${encodedPayload}.signature`;
        
        // Test with Bearer+ prefix (as it appears in cookies)
        account.setToken('Bearer+' + fakeToken);
        
        if(account.customerId !== 'settoken-test-456') test.fail();
        if(account.email !== 'settoken@example.com') test.fail();
        
    }catch(err){
        console.trace(err);
        test.fail();
    }
    test.pass();
    test.done();

    // Test 4: Token expiration check
    try{
        test.expects(`Account.isTokenValid to return false for expired token`);    
        const expiredPayload = {
            CustomerID: 'expired-customer',
            Email: 'expired@example.com',
            exp: Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
        };
        const encodedPayload = Buffer.from(JSON.stringify(expiredPayload)).toString('base64');
        const expiredToken = `header.${encodedPayload}.signature`;
        
        const account = new Account({ token: expiredToken });
        
        if(account.isTokenValid()) test.fail(); // Should be false for expired token
        
    }catch(err){
        console.trace(err);
        test.fail();
    }
    test.pass();
    test.done();

    // Test 5: getPoints without login should throw
    try{
        test.expects(`Account.getPoints to throw if not logged in`);    
        const account = new Account({
            email: 'test@example.com',
            password: 'password123'
        });
        
        await account.getPoints();
        test.fail(); // Should have thrown
    }catch(err){
        if(err.message !== 'You must login first to get points.'){
            console.trace(err);
            test.fail();
        }
    }
    test.pass();
    test.done();
}

export {
    runTest as default,
    runTest
}
