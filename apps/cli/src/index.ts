#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { setApiKey, clearConfig, isConfigured, getConfig, isApiMode, setCredentials } from './config.js';
import { getMcpClientPaths, configureMcpFile, configureClaudeCode } from './setup.js';
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
          // Set config in memory for the verify call — only persist after success
          api.setApiConfig(options.apiKey, options.apiUrl);

          const spinner = ora('Verifying API key...').start();
          try {
            const numbers = await api.listNumbers();
            // Save only after successful verification
            setApiKey(options.apiKey, options.apiUrl);
            spinner.succeed(`Connected! You have ${numbers.length} phone number(s)`);
          } catch (error) {
            spinner.fail(`Connection failed: ${(error as Error).message}`);
            console.log(chalk.dim('Key was not saved. Check your key and try again.'));
            process.exit(1);
          }
        } else {
          console.log(chalk.red('API key required.'));
          console.log('\nRun:');
          console.log(chalk.cyan('  botcall auth login --api-key bs_live_xxxxx\n'));
          console.log('Or set environment variable:');
          console.log(chalk.cyan('  export BOTCALL_API_KEY=bs_live_xxxxx'));
          process.exit(1);
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
            console.log(`  URL: ${cfg.apiUrl || 'https://api.botcall.io'}`);
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
  .option('-n, --number-id <id>', 'Filter by phone number ID (from: botcall list --json)')
  .option('--json', 'Output as JSON')
  .action(async (options: { limit?: string; numberId?: string; json?: boolean }) => {
    if (!isConfigured()) {
      console.error(chalk.red('Not authenticated. Run: botcall auth login --api-key YOUR_KEY'));
      process.exit(1);
    }

    const spinner = ora('Fetching inbox...').start();

    try {
      const messages = await api.getMessages({
        limit: parseInt(options.limit || '10', 10),
        numberId: options.numberId,
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
  .option('-t, --timeout <seconds>', 'Timeout in seconds (default: 30, max: 30)', '30')
  .option('-n, --number-id <id>', 'Target a specific phone number ID (from: botcall list --json)')
  .action(async (options: { timeout?: string; numberId?: string }) => {
    if (!isConfigured()) {
      console.error(chalk.red('Not authenticated. Run: botcall auth login --api-key YOUR_KEY'));
      process.exit(1);
    }

    const timeout = Math.min(parseInt(options.timeout || '30', 10), 30);
    const spinner = ora('Waiting for verification code...').start();

    try {
      // Get current timestamp to filter new messages
      const since = new Date().toISOString();

      const result = await api.pollForMessage({ timeout, since, numberId: options.numberId });
      
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

// ============ USAGE ============

program
  .command('usage')
  .description('Show current plan and usage')
  .action(async () => {
    if (!isConfigured()) {
      console.error(chalk.red('Not authenticated. Run: botcall auth login --api-key YOUR_KEY'));
      process.exit(1);
    }

    const spinner = ora('Fetching usage...').start();
    
    try {
      const usage = await api.getUsage();
      spinner.stop();
      
      console.log('\n' + chalk.bold('Plan: ') + chalk.cyan(usage.plan.toUpperCase()));
      console.log('\nLimits:');
      console.log(`  Phone numbers: ${usage.usage.phoneNumbers}/${usage.limits.phoneNumbers}`);
      console.log(`  SMS this month: ${usage.usage.smsThisMonth}/${usage.limits.smsPerMonth}`);
      
      if (usage.plan === 'inactive') {
        console.log('\n' + chalk.yellow('Upgrade to provision phone numbers:'));
        console.log(chalk.cyan('  botcall upgrade starter') + ' - $9/mo (1 number, 100 SMS)');
        console.log(chalk.cyan('  botcall upgrade pro') + '     - $29/mo (5 numbers, 500 SMS)');
      }
    } catch (error) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ============ UPGRADE ============

program
  .command('upgrade')
  .description('Upgrade to a paid plan')
  .argument('<plan>', 'Plan to upgrade to (starter | pro)')
  .action(async (plan: string) => {
    if (!isConfigured()) {
      console.error(chalk.red('Not authenticated. Run: botcall auth login --api-key YOUR_KEY'));
      process.exit(1);
    }

    if (!['starter', 'pro'].includes(plan)) {
      console.error(chalk.red('Invalid plan. Choose: starter ($9/mo) or pro ($29/mo)'));
      process.exit(1);
    }

    const spinner = ora('Creating checkout session...').start();
    
    try {
      const { url } = await api.createCheckout(plan as 'starter' | 'pro');
      spinner.stop();
      
      console.log(chalk.green('Opening checkout in browser...\n'));
      console.log('If browser doesn\'t open, visit:');
      console.log(chalk.cyan(url) + '\n');
      
      // Open URL in default browser
      const { exec } = await import('child_process');
      const command = process.platform === 'darwin' ? 'open' 
        : process.platform === 'win32' ? 'start' 
        : 'xdg-open';
      exec(`${command} "${url}"`);
    } catch (error) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ============ BILLING ============

program
  .command('billing')
  .description('Manage your subscription')
  .action(async () => {
    if (!isConfigured()) {
      console.error(chalk.red('Not authenticated. Run: botcall auth login --api-key YOUR_KEY'));
      process.exit(1);
    }

    const spinner = ora('Opening billing portal...').start();
    
    try {
      const { url } = await api.createPortal();
      spinner.stop();
      
      console.log(chalk.green('Opening billing portal in browser...\n'));
      console.log('If browser doesn\'t open, visit:');
      console.log(chalk.cyan(url) + '\n');
      
      // Open URL in default browser
      const { exec } = await import('child_process');
      const command = process.platform === 'darwin' ? 'open' 
        : process.platform === 'win32' ? 'start' 
        : 'xdg-open';
      exec(`${command} "${url}"`);
    } catch (error) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ============ SETUP ============

program
  .command('setup')
  .description('One-command setup: saves API key, configures MCP clients, provisions a number, and confirms SMS works')
  .requiredOption('--api-key <key>', 'Your botcall API key (starts with bs_live_)')
  .option('--api-url <url>', 'API URL (optional, for self-hosted)')
  .action(async (options: { apiKey: string; apiUrl?: string }) => {
    const { apiKey, apiUrl } = options;

    // 1. Save key
    setApiKey(apiKey, apiUrl);
    api.setApiConfig(apiKey, apiUrl);
    console.log(chalk.green('✓ API key saved'));

    // 2. Check plan
    const spinner = ora('Checking account...').start();
    let usage;
    try {
      usage = await api.getUsage();
      spinner.stop();
    } catch (error) {
      spinner.fail(`Failed to connect: ${(error as Error).message}`);
      process.exit(1);
    }

    if (!usage.canProvision) {
      console.log('\n' + chalk.yellow('Cannot provision a phone number with your current plan.'));
      console.log('Upgrade at: ' + chalk.cyan('https://botcall.io/dashboard'));
      process.exit(1);
    }

    // 3. Configure MCP clients
    console.log('\n' + chalk.bold('Configuring MCP clients...'));
    const mcpPaths = getMcpClientPaths();
    for (const [name, filePath] of Object.entries(mcpPaths)) {
      const result = configureMcpFile(filePath, apiKey);
      if (result.configured) {
        const tag = result.created ? chalk.dim('(created)') : chalk.dim('(updated)');
        console.log(chalk.green(`  ✓ ${name}`) + ' ' + tag);
      } else {
        console.log(chalk.yellow(`  ✗ ${name}: ${result.error}`));
      }
    }

    // 4. Claude Code CLI
    const ccResult = await configureClaudeCode(apiKey);
    if (ccResult.configured) {
      console.log(chalk.green('  ✓ Claude Code'));
    } else {
      console.log(chalk.dim('  · Claude Code: run manually if needed:'));
      console.log(chalk.cyan(`    BOTCALL_API_KEY=${apiKey} claude mcp add botcall -- npx -y botcall-mcp`));
    }

    // 5. Provision a number
    console.log('');
    const provSpinner = ora('Provisioning phone number...').start();
    let number: string;
    try {
      const result = await api.provisionNumber({});
      number = result.number;
      provSpinner.succeed(`Provisioned: ${chalk.green(number)}`);
    } catch (error) {
      provSpinner.fail(`Failed to provision: ${(error as Error).message}`);
      process.exit(1);
    }

    // 6. Instructions
    console.log('\n' + chalk.bold('Almost done!'));
    console.log(`Send a text with a code to ${chalk.cyan(number)} to verify everything works.\n`);

    // 7. Poll for confirmation
    const pollSpinner = ora('Waiting for test SMS (30s)...').start();
    try {
      const since = new Date().toISOString();
      const result = await api.pollForMessage({ timeout: 30, since });
      pollSpinner.stop();
      const code = result.code || api.extractCode(result.message.body);
      if (code) {
        console.log(chalk.green(`✓ Got it! Code: ${chalk.bold(code)}`));
      } else {
        console.log(chalk.green('✓ SMS received:'), result.message.body);
      }
      console.log('\n' + chalk.bold('Setup complete.') + ' Your number: ' + chalk.cyan(number));
    } catch (error) {
      pollSpinner.warn('No SMS received within 30s — but setup is complete.');
      console.log('Your number: ' + chalk.cyan(number));
      console.log('Test with: ' + chalk.cyan('botcall get-code'));
    }
  });

program.parse();
