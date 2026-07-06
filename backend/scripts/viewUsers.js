/**
 * View All Users Script
 * 
 * Simple script to view all users currently in the database
 * Usage: node scripts/viewUsers.js
 */

import { Level } from 'level';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path
const dbPath = path.join(__dirname, '../data/users');
const usersDb = new Level(dbPath, { valueEncoding: 'json' });

async function viewUsers() {
  console.log('\n📋 Current Users in Database\n');
  console.log('═'.repeat(100));
  
  try {
    await usersDb.open();
    
    const users = [];
    for await (const [key, user] of usersDb.iterator()) {
      users.push({ id: key, ...user });
    }
    
    if (users.length === 0) {
      console.log('\n  No users found in database.\n');
      console.log('  Super users will be created when they log in.');
      console.log('  Regular users will be created when they make their first submission.\n');
      console.log('═'.repeat(100));
      console.log('\n');
      process.exit(0);
    }
    
    console.log(`\nTotal Users: ${users.length}\n`);
    
    users.forEach((user, index) => {
      const roleEmoji = user.role === 'super' ? '👑' : '👤';
      console.log(`${roleEmoji} User ${index + 1}`);
      console.log(`   Email:      ${user.email}`);
      console.log(`   Name:       ${user.name || 'N/A'}`);
      console.log(`   Role:       ${user.role.toUpperCase()}`);
      console.log(`   Provider:   ${user.provider}`);
      console.log(`   Created:    ${new Date(user.createdAt).toLocaleString()}`);
      console.log(`   Last Login: ${new Date(user.lastLogin).toLocaleString()}`);
      console.log(`   ID:         ${user.id}`);
      console.log('─'.repeat(100));
    });
    
    const superUsers = users.filter(u => u.role === 'super').length;
    const regularUsers = users.filter(u => u.role === 'user').length;
    
    console.log(`\n📊 Summary:`);
    console.log(`   👑 Super Users: ${superUsers}`);
    console.log(`   👤 Regular Users: ${regularUsers}`);
    console.log(`   📝 Total: ${users.length}\n`);
    
    console.log('═'.repeat(100));
    console.log('\n');
    
    await usersDb.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await usersDb.close();
    process.exit(1);
  }
}

viewUsers();
