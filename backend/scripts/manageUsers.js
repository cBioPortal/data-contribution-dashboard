/**
 * Admin Script - Manage User Roles
 * 
 * Run this script to list users and change their roles
 * Usage: node scripts/manageUsers.js
 */

import { Level } from 'level';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path
const dbPath = path.join(__dirname, '../data/users');
const usersDb = new Level(dbPath, { valueEncoding: 'json' });

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper to ask questions
function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// List all users
async function listUsers() {
  console.log('\n📋 All Users:\n');
  console.log('Index | Email                    | Name                | Role   | Provider');
  console.log('─────────────────────────────────────────────────────────────────────────');
  
  const users = [];
  let index = 1;
  
  for await (const [key, user] of usersDb.iterator()) {
    users.push({ id: key, ...user });
    const email = user.email.padEnd(24);
    const name = (user.name || 'N/A').padEnd(19);
    const role = user.role.padEnd(6);
    console.log(`${index.toString().padStart(5)} | ${email} | ${name} | ${role} | ${user.provider}`);
    index++;
  }
  
  console.log('─────────────────────────────────────────────────────────────────────────\n');
  return users;
}

// Promote user to super
async function promoteUser(userId) {
  try {
    const user = await usersDb.get(userId);
    user.role = 'super';
    user.updatedAt = new Date().toISOString();
    await usersDb.put(userId, user);
    console.log(`✅ User promoted to super: ${user.email}`);
  } catch (error) {
    console.error('❌ Error promoting user:', error.message);
  }
}

// Demote user to regular
async function demoteUser(userId) {
  try {
    const user = await usersDb.get(userId);
    user.role = 'user';
    user.updatedAt = new Date().toISOString();
    await usersDb.put(userId, user);
    console.log(`✅ User demoted to regular user: ${user.email}`);
  } catch (error) {
    console.error('❌ Error demoting user:', error.message);
  }
}

// Main menu
async function main() {
  console.log('\n🔐 User Role Management\n');
  
  try {
    await usersDb.open();
    
    const users = await listUsers();
    
    if (users.length === 0) {
      console.log('No users found. Users will be created when they log in via OAuth.\n');
      process.exit(0);
    }
    
    const action = await question('Choose action:\n1. Promote user to super\n2. Demote user to regular\n3. Exit\n\nEnter choice (1-3): ');
    
    if (action === '3') {
      console.log('Goodbye!');
      process.exit(0);
    }
    
    const userIndex = await question('\nEnter user index: ');
    const selectedUser = users[parseInt(userIndex) - 1];
    
    if (!selectedUser) {
      console.log('❌ Invalid user index');
      process.exit(1);
    }
    
    console.log(`\nSelected user: ${selectedUser.email} (Current role: ${selectedUser.role})`);
    const confirm = await question('Confirm? (yes/no): ');
    
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Cancelled.');
      process.exit(0);
    }
    
    if (action === '1') {
      await promoteUser(selectedUser.id);
    } else if (action === '2') {
      await demoteUser(selectedUser.id);
    }
    
    await usersDb.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
