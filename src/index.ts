#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { setApiKey, clearConfig, isConfigured, getConfig, isApiMode, setCredentials } from './config.js';
import * as api from './api.js';

// Initialize API config if available
const cfg = getConfig();
if (cfg.apiKey) {
  api.setApiConfig(cfg.apiKey, cfg.apiUrl);
}

program
  .name('botcall')
  .description('Phone numbers for AI agents. Dead simple.')
  .version('0.1.0');

// ============ AUTH ============

program
  .command('auth')
  .description('Manage authentication')
  .argument('<action>', 'login | logout | status')
  .option('--api-key <key>', 'Botcall API key (starts with bs_live_)')
  .option('--api-url <url>', 'API URL (optional, for self-hosted)')
  .action(async (action: string, options: { apiKey?: string; apiUrl?: string }) => {
    switch (action) {
      case 'login':
        if (options.apiKey) {
          setApiKey(options.apiKey, options.apiUrl);
          api.setApiConfig(options.apiKey, options.apiUrl);
          console.log(chalk.green('✓ API key saved'));
          
          // Test the connection
          const spinner = ora('Verifying...').start();
          try {
            const numbers = await api.listNumbers();
            spinner.succeed(`Connected! You have ${numbers.length} phone number(s)`);
          } catch (error) {
            spinner.fail(`Connection failed: ${(error as Error).message}`);
          }
        } else {
          console.log('API key required. Get one from https://botcall.io\n');
          console.log('Run:');
          console.log(chalk.cyan('  botcall auth login --api-key bs_live_xxxxx\n'));
          console.log('Or set environment variable:');
          console.log(chalk.cyan('  export BOTCALL_API_KEY=bs_live_xxxxx'));
        }
        break;
      case 'logout':
        clearConfig();
        console.log(chalk.green('✓ Logged out'));
        break;
      case 'status':
        if (isConfigured()) {
          const cfg = getConfig();
          if (isApiMode()) {
            console.log(chalk.green('✓ Authenticated (API mode)'));
            console.log(`  Key: ${cfg.apiKey?.slice(0, 12)}...`);
            console.log(`  URL: ${cfg.apiUrl || 'https://botcall-api-production.up.railway.app'}`);
          } else {
            console.log(chalk.green('✓ Authenticated (legacy Signalwire mode)'));
            console.log(`  Space: ${cfg.spaceUrl}`);
          }
        } else {
          console.log(chalk.yellow('Not authenticated'));
          console.log('Run: botcall auth login --api-key YOUR_KEY');
        }
        break;
      default:
        console.error(`Unknown action: ${action}`);
        process.exit(1);
    }
  });

// ============ PROVISION ============

program
  .command('provision')
  .description('Get a new phone number')
  .option('-a, --area-code <code>', 'Area code (e.g., 206 for Seattle)')
  .option('-c, --country <code>', 'Country code (default: US)')
  .option('--auto', 'Automatically provision first available number')
  .action(async (options: { areaCode?: string; country?: string; auto?: boolean }) => {
    if (!isConfigured()) {
      console.error(chalk.red('Not authenticated. Run: botcall auth login --api-key YOUR_KEY'));
      process.exit(1);
    }

    const spinner = ora('Provisioning number...').start();
    
    try {
      const number = await api.provisionNumber({
        areaCode: options.areaCode,
        country: options.country,
      });
      
      spinner.succeed(`Provisioned: ${chalk.green(number.number)}`);
      console.log(number.number); // Clean output for scripts
    } catch (error) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ============ LIST ============

program
  .command('list')
  .alias('ls')
  .description('List your phone numbers')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    if (!isConfigured()) {
      console.error(chalk.red('Not authenticated. Run: botcall auth login --api-key YOUR_KEY'));
      process.exit(1);
    }

    const spinner = ora('Fetching numbers...').start();
    
    try {
      const numbers = await api.listNumbers();
      spinner.stop();
      
      if (numbers.length === 0) {
        console.log(chalk.yellow('No numbers provisioned. Run: botcall provision'));
        return;
      }
      
      if (options.json) {
        console.log(JSON.stringify(numbers, null, 2));
      } else {
        console.log('\nYour numbers:\n');
        numbers.forEach(num => {
          const caps = [];
          if (num.capabilities.sms) caps.push('SMS');
          if (num.capabilities.voice) caps.push('Voice');
          if (num.capabilities.mms) caps.push('MMS');
          console.log(`  ${chalk.cyan(num.number)} (${num.status}) - ${caps.join(', ')}`);
        });
      }
    } catch (error) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ============ SMS ============
// NOTE: Sending SMS requires 10DLC registration (US regulatory requirement)
// This is disabled until registration is complete

// program
//   .command('sms')
//   .description('Send an SMS (requires 10DLC registration)')
//   .argument('<to>', 'Recipient phone number')
//   .argument('<message>', 'Message text')
//   .action(async (to: string, message: string) => {
//     console.log(chalk.yellow('Sending SMS requires 10DLC registration (US regulatory requirement).'));
//     console.log('This feature will be available once registration is complete.');
//     process.exit(1);
//   });

// ============ INBOX ============

program
  .command('inbox')
  .description('View received messages')
  .option('-l, --limit <n>', 'Number of messages', '10')
  .option('--json', 'Output as JSON')
  .action(async (options: { limit?: string; json?: boolean }) => {
    if (!isConfigured()) {
      console.error(chalk.red('Not authenticated. Run: botcall auth login --api-key YOUR_KEY'));
      process.exit(1);
    }

    const spinner = ora('Fetching inbox...').start();
    
    try {
      const messages = await api.getMessages({
        limit: parseInt(options.limit || '10', 10),
      });
      spinner.stop();
      
      if (messages.length === 0) {
        console.log(chalk.yellow('No messages yet'));
        return;
      }
      
      if (options.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        console.log('\nRecent messages:\n');
        messages.forEach(msg => {
          const codeTag = msg.code ? chalk.green(` [CODE: ${msg.code}]`) : '';
          const arrow = msg.direction === 'inbound' ? '←' : '→';
          console.log(`  ${chalk.dim(msg.receivedAt)}`);
          console.log(`  ${arrow} ${chalk.cyan(msg.direction === 'inbound' ? msg.from : msg.to)}${codeTag}`);
          console.log(`  ${msg.body}\n`);
        });
      }
    } catch (error) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ============ GET-CODE ============

program
  .command('get-code')
  .description('Wait for SMS and extract verification code')
  .option('-t, --timeout <seconds>', 'Timeout in seconds (default: 120)', '120')
  .action(async (options: { timeout?: string }) => {
    if (!isConfigured()) {
      console.error(chalk.red('Not authenticated. Run: botcall auth login --api-key YOUR_KEY'));
      process.exit(1);
    }

    const timeout = parseInt(options.timeout || '120', 10);
    const spinner = ora('Waiting for verification code...').start();
    
    try {
      // Get current timestamp to filter new messages
      const since = new Date().toISOString();
      
      const result = await api.pollForMessage({ timeout, since });
      
      if (result.code) {
        spinner.stop();
        console.log(result.code);
      } else {
        // Try to extract code locally
        const code = api.extractCode(result.message.body);
        spinner.stop();
        if (code) {
          console.log(code);
        } else {
          console.log(chalk.yellow('Message received but no code found:'));
          console.log(result.message.body);
        }
      }
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('TIMEOUT')) {
        spinner.fail('Timeout waiting for verification code');
      } else {
        spinner.fail(`Failed: ${msg}`);
      }
      process.exit(1);
    }
  });

// ============ RELEASE ============

program
  .command('release')
  .description('Release a phone number')
  .argument('<number-id>', 'Phone number ID to release')
  .action(async (numberId: string) => {
    if (!isConfigured()) {
      console.error(chalk.red('Not authenticated. Run: botcall auth login --api-key YOUR_KEY'));
      process.exit(1);
    }

    const spinner = ora('Releasing number...').start();
    
    try {
      await api.releaseNumber(numberId);
      spinner.succeed('Number released');
    } catch (error) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
