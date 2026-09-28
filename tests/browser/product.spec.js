import { test, expect } from '@playwright/test';
const stamp = Date.now();
async function register(page, name, email) {
  await page.goto('/');
  await page.getByLabel('Your name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Create your workspace' }).click();
  await expect(page.getByRole('heading', { name: new RegExp('Good .*' + name) })).toBeVisible();
}
async function openWelcome(page) {
  await page.locator('.recent-card').first().click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText(
    'Getting started',
  );
}
async function title(page, value) {
  await page.getByRole('textbox', { name: 'Page title', exact: true }).fill(value);
  await page.getByRole('textbox', { name: 'Page title', exact: true }).press('Tab');
  await expect(page.locator('.save-state')).toHaveText('Saved');
  await expect
    .poll(async () => {
      const id = await page.evaluate(() => location.hash.slice(1));
      return (await (await page.request.get('/api/pages/' + id)).json()).title;
    })
    .toBe(value);
}

test('real editor, nested navigation, slash commands, formatting, search, favorites, trash and history', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await register(page, 'Alice', `alice-${stamp}@example.com`);
  await openWelcome(page);
  await title(page, 'Product handbook');
  const block = page.getByRole('textbox', { name: 'text block', exact: true }).first();
  await block.fill('A persistent product decision');
  await block.press('Tab');
  await expect
    .poll(async () => {
      const id = await page.evaluate(() => location.hash.slice(1));
      return (await (await page.request.get('/api/pages/' + id)).json()).blocks.some(
        (b) => b.html === 'A persistent product decision',
      );
    })
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText(
    'Product handbook',
  );
  await expect(page.getByText('A persistent product decision', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Complete task' }).first().check();
  await expect(page.getByRole('checkbox', { name: 'Complete task' }).first()).toBeChecked();
  await page.getByRole('button', { name: 'Click to add a block, or press Enter' }).click();
  const last = page.getByRole('textbox', { name: 'text block', exact: true }).last();
  await last.fill('/heading');
  await expect(page.locator('.block-menu')).toBeVisible();
  await page
    .locator('.block-menu')
    .getByRole('button', { name: 'Heading 2 Medium section heading.' })
    .click();
  const heading = page.getByRole('textbox', { name: 'heading2 block' }).last();
  await heading.fill('Roadmap');
  await heading.press('End');
  await heading.press('Enter');
  await expect(page.getByRole('textbox', { name: 'text block', exact: true })).toHaveCount(3);
  const line = page.getByRole('textbox', { name: 'text block', exact: true }).last();
  await line.fill('Ship something useful');
  await line.press('Control+a');
  await line.press('Control+b');
  await line.press('Tab');
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await page.getByRole('button', { name: 'New sub-page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText('');
  await title(page, 'Engineering notes');
  await page.getByRole('textbox', { name: 'text block', exact: true }).fill('Nested page content');
  await page.getByRole('textbox', { name: 'text block', exact: true }).press('Tab');
  await expect(page.locator('.breadcrumbs')).toContainText('Product handbook');
  await page.getByRole('button', { name: 'Search Ctrl K' }).click();
  await page.getByPlaceholder('Search pages and content…').fill('persistent product');
  await expect(page.locator('.search-results')).toContainText('Product handbook');
  await page
    .locator('.search-results')
    .getByRole('button', { name: /Product handbook/ })
    .click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText(
    'Product handbook',
  );
  await page.getByRole('button', { name: 'Page menu', exact: true }).click();
  await page.getByRole('button', { name: 'Page history', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Page history' }).locator('.history-row').first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Page menu', exact: true }).click();
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(page.locator('.trash-row')).toContainText('Product handbook');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('Trash is empty')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.tree-title').filter({ hasText: 'Product handbook' }).click();
  await expect(page.locator('.child-pages')).toContainText('Engineering notes');
  await expect(page.getByText('Roadmap', { exact: true })).toBeVisible();
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('database records, typed properties, table/board/calendar/list/gallery and saved view settings', async ({
  page,
}) => {
  await register(page, 'Database', `db-${stamp}@example.com`);
  await page.getByRole('button', { name: 'Database Bring structure to your projects' }).click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText(
    'Projects',
  );
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText('');
  await title(page, 'Launch website');
  // Exercise consecutive property edits with realistic network latency.
  await page.route('**/api/pages/*', async (route) => {
    if (route.request().method() === 'PATCH')
      await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });
  await page.getByLabel('Status', { exact: true }).selectOption('In progress');
  await page.getByLabel('Due date', { exact: true }).fill('2026-10-15');
  await page.getByLabel('Due date', { exact: true }).press('Tab');
  await page.locator('.breadcrumbs').getByRole('button', { name: 'Projects' }).click();
  await expect(page.locator('table')).toContainText('Launch website');
  await expect(page.locator('table').getByLabel('Status')).toHaveValue('In progress');
  await expect(page.locator('table').getByLabel('Due date')).toHaveValue('2026-10-15');
  await page.locator('table').getByLabel('Status').selectOption('Done');
  await page.locator('table').getByLabel('Status').selectOption('In progress');
  await expect(page.locator('table').getByLabel('Status')).toHaveValue('In progress');
  await page.getByRole('button', { name: 'Add property', exact: true }).click();
  await page.getByLabel('Property name', { exact: true }).fill('Estimate');
  await page.getByLabel('Type', { exact: true }).selectOption('number');
  await page.getByRole('dialog').getByRole('button', { name: 'Add property', exact: true }).click();
  await page.getByLabel('Estimate', { exact: true }).fill('8');
  await page.getByLabel('Estimate', { exact: true }).press('Tab');
  for (const type of ['board', 'gallery', 'list', 'calendar']) {
    await page.getByRole('button', { name: 'Add a view', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: type, exact: true }).click();
    await page.getByRole('button', { name: 'Create view', exact: true }).click();
    await expect(
      page
        .locator('.view-tabs')
        .getByRole('button', { name: type[0].toUpperCase() + type.slice(1), exact: true }),
    ).toBeVisible();
  }
  await page.locator('.view-tabs').getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.locator('.board-column').filter({ hasText: 'In progress' })).toContainText(
    'Launch website',
  );
  await page.getByRole('button', { name: 'Filter database' }).click();
  await page.getByRole('dialog').getByLabel('Status', { exact: true }).selectOption('Done');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.database-card')).toHaveCount(0);
  await page.reload();
  await page.locator('.view-tabs').getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.locator('.filter-pill')).toContainText('Done');
  await page.getByRole('button', { name: 'Filter database' }).click();
  await page.getByRole('dialog').getByLabel('Status', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.database-card')).toContainText('Launch website');
  await expect(page.locator('.page-title')).toHaveCount(1);
  await expect(page.locator('.page-title')).toHaveText('Projects');
  await expect(page.locator('.board')).toBeInViewport();
  await page.screenshot({ path: 'test-results/database-board.png', fullPage: true });
});

test('two users share, collaborate live, comment, and enforce read-only and revoked access', async ({
  page,
  browser,
}) => {
  const other = await browser.newContext();
  const bob = await other.newPage();
  const aliceEmail = `share-alice-${stamp}@example.com`,
    bobEmail = `share-bob-${stamp}@example.com`;
  await register(page, 'Owner', aliceEmail);
  await register(bob, 'Guest', bobEmail);
  await openWelcome(page);
  await title(page, 'Shared project');
  const url = page.url();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByLabel('Invite email', { exact: true }).fill(bobEmail);
  await page.getByLabel('Permission', { exact: true }).selectOption('edit');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.locator('.member-row')).toContainText(bobEmail);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await bob.goto(url);
  await expect(bob.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText(
    'Shared project',
  );
  await expect(page.locator('.presence .avatar')).toHaveCount(2);
  const block = page.getByRole('textbox', { name: 'text block', exact: true }).first();
  await block.fill('Live synchronized content');
  await block.press('Tab');
  await expect(bob.getByText('Live synchronized content', { exact: true })).toBeVisible();
  await bob.getByRole('button', { name: 'Comments', exact: true }).click();
  await bob.getByLabel('Write a comment', { exact: true }).fill('Looks good to me');
  await bob.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await expect(page.locator('.comments-list')).toContainText('Looks good to me');
  await page.getByRole('button', { name: 'Resolve comment' }).click();
  await expect(page.locator('.comments-list')).not.toContainText('Looks good to me');
  await page.getByRole('button', { name: 'Close comments' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByLabel('Permission for Guest', { exact: true }).selectOption('view');
  await expect(bob.getByRole('textbox', { name: 'Page title', exact: true })).toHaveAttribute(
    'contenteditable',
    'false',
  );
  await page.getByRole('button', { name: 'Remove access for Guest', exact: true }).click();
  await expect(bob.getByRole('heading', { name: 'Page unavailable' })).toBeVisible();
  await other.close();
});

test('workspace membership, switching, dark theme, mobile editing, and login', async ({ page }) => {
  const email = `mobile-${stamp}@example.com`;
  await register(page, 'Mobile', email);
  await page.getByRole('button', { name: 'Settings & members' }).click();
  await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.workspace-button').click();
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('Research lab');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.workspace-button')).toContainText('Research lab');
  await page.getByRole('button', { name: 'Empty page A blank canvas for your thoughts' }).click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText('');
  await title(page, 'Mobile document');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText(
    'Mobile document',
  );
  const block = page.getByRole('textbox', { name: 'text block', exact: true });
  await block.fill('Written on a small screen');
  await block.press('Tab');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/mobile-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByRole('heading', { name: /Good .*Mobile/ })).toBeVisible();
});

test('Markdown import/export and anonymous publication with nested pages and revocation', async ({
  page,
  browser,
}) => {
  await register(page, 'Publisher', `publisher-${stamp}@example.com`);
  await openWelcome(page);
  await title(page, 'Published guide');
  await page.getByRole('button', { name: 'Page menu', exact: true }).click();
  await page.getByRole('button', { name: 'Import Markdown', exact: true }).click();
  await page
    .getByLabel('Markdown content', { exact: true })
    .fill('## Imported heading\n\n- [x] Imported task\n\n```js\nconsole.log("saved");\n```');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'heading2 block' }).last()).toHaveText(
    'Imported heading',
  );
  await page.getByRole('button', { name: 'Page menu', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Markdown', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Published guide.md');
  const stream = await download.createReadStream();
  let markdown = '';
  for await (const chunk of stream) markdown += chunk;
  expect(markdown).toContain('## Imported heading');
  expect(markdown).toContain('- [x] Imported task');
  await page.getByRole('button', { name: 'New sub-page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText('');
  await title(page, 'Published child');
  await page.locator('.breadcrumbs').getByRole('button', { name: 'Published guide' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByLabel('Publish to the web', { exact: true }).check();
  const publicLink = page.getByLabel('Public link', { exact: true });
  await expect(publicLink).toBeVisible();
  const url = await publicLink.inputValue();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(url);
  await expect(guest.getByRole('heading', { name: 'Published guide', exact: true })).toBeVisible();
  await expect(guest.getByText('Imported heading', { exact: true })).toBeVisible();
  await expect(guest.locator('[contenteditable=true]')).toHaveCount(0);
  await guest.locator('.child-pages').getByRole('button', { name: 'Published child' }).click();
  await expect(guest.getByRole('heading', { name: 'Published child', exact: true })).toBeVisible();
  await page.getByLabel('Publish to the web', { exact: true }).uncheck();
  await expect(publicLink).toHaveCount(0);
  await guest.reload();
  await expect(guest.getByRole('heading', { name: 'Page unavailable' })).toBeVisible();
  await guestContext.close();
});

test('block splitting, nested toggle children, reordering, duplicate and delete survive reload', async ({
  page,
}) => {
  await register(page, 'Editor', `editor-${stamp}@example.com`);
  await page.getByRole('button', { name: 'Empty page A blank canvas for your thoughts' }).click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText('');
  await title(page, 'Editor behavior');
  const first = page.getByRole('textbox', { name: 'text block', exact: true }).first();
  await first.fill('Hello world');
  await first.press('Home');
  for (let i = 0; i < 6; i++) await first.press('ArrowRight');
  await first.press('Enter');
  await expect(page.getByRole('textbox', { name: 'text block', exact: true })).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'text block', exact: true }).first()).toHaveText(
    'Hello ',
  );
  await expect(page.getByRole('textbox', { name: 'text block', exact: true }).last()).toHaveText(
    'world',
  );
  await page.getByRole('button', { name: 'Click to add a block, or press Enter' }).click();
  const toggle = page.getByRole('textbox', { name: 'text block', exact: true }).last();
  await toggle.fill('/toggle');
  await page
    .locator('.block-menu')
    .getByRole('button', { name: 'Toggle list Hide or show a line of content.' })
    .click();
  await page.getByRole('textbox', { name: 'toggle block' }).fill('Details');
  await page.getByRole('textbox', { name: 'toggle block' }).press('End');
  await page.getByRole('textbox', { name: 'toggle block' }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'text block', exact: true })).toHaveCount(3);
  await page
    .getByRole('textbox', { name: 'text block', exact: true })
    .last()
    .fill('Nested toggle content');
  await page.getByRole('textbox', { name: 'text block', exact: true }).last().press('Tab');
  await page.getByRole('button', { name: 'Collapse toggle', exact: true }).click();
  await expect(page.getByText('Nested toggle content', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Details', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand toggle', exact: true }).click();
  await expect(page.getByText('Nested toggle content', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Nested toggle content', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'text block', exact: true }).first().hover();
  await page
    .locator('.block')
    .first()
    .getByRole('button', { name: 'Block actions', exact: true })
    .click();
  await page.locator('.block-menu').getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByText('Hello ', { exact: true })).toHaveCount(2);
  await page.locator('.block').first().hover();
  await page
    .locator('.block')
    .first()
    .getByRole('button', { name: 'Block actions', exact: true })
    .click();
  await page.locator('.block-menu').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Hello ', { exact: true })).toHaveCount(1);
  const blocks = page.locator('.block');
  const before = await blocks.evaluateAll((nodes) => nodes.map((n) => n.dataset.block));
  await blocks.nth(1).hover();
  await blocks
    .nth(1)
    .getByRole('button', { name: 'Block actions', exact: true })
    .dragTo(blocks.nth(0));
  await expect
    .poll(async () => blocks.evaluateAll((nodes) => nodes.map((n) => n.dataset.block)))
    .not.toEqual(before);
  await page.reload();
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'toggle block' })).toHaveText('Details');
});

test('workspace invitation grants shared pages, keeps private pages private, and removal revokes membership', async ({
  page,
  browser,
}) => {
  const context = await browser.newContext();
  const member = await context.newPage();
  const email = `member-${stamp}@example.com`;
  await register(page, 'Admin', `admin-${stamp}@example.com`);
  await register(member, 'Member', email);
  await page.getByRole('button', { name: 'Add workspace page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveText('');
  await title(page, 'Team notes');
  await page.getByRole('button', { name: 'Settings & members', exact: true }).click();
  await page.getByLabel('Member email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Add member', exact: true }).click();
  await expect(page.locator('.member-row').filter({ hasText: email })).toBeVisible();
  await member.locator('.workspace-button').click();
  await expect(
    member.getByRole('dialog').getByRole('button', { name: /Admin's workspace/ }),
  ).toBeVisible();
  await member
    .getByRole('dialog')
    .getByRole('button', { name: /Admin's workspace/ })
    .click();
  await expect(member.locator('.tree-title').filter({ hasText: 'Team notes' })).toBeVisible();
  await expect(member.locator('.tree-title').filter({ hasText: 'Getting started' })).toHaveCount(0);
  await member.locator('.tree-title').filter({ hasText: 'Team notes' }).click();
  await member
    .getByRole('textbox', { name: 'text block', exact: true })
    .fill('Team member contribution');
  await member.getByRole('textbox', { name: 'text block', exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Team member contribution', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings & members', exact: true }).click();
  await page.getByRole('button', { name: 'Remove member Member', exact: true }).click();
  await expect(
    member.getByRole('heading', { name: 'Page unavailable', exact: true }),
  ).toBeVisible();
  await context.close();
});
