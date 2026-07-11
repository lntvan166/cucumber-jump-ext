#!/usr/bin/env python3
"""
Cucumber Jump 2.1.0 manual-test seeder.

Creates a throwaway multi-language workspace that exercises every resolution
path of the extension — all 9 languages, the legacy Go bddFile path, and the
specific 2.1.0 review fixes (string-literal escapes, C# verbatim strings,
*.steps.ts / {js,ts} globs, reverse-navigation anchoring, the anonymous {}
parameter, Dev mode from non-Go step files, loud diagnostics for undetectable
globs). A TESTPLAN.md checklist is written into the workspace root.

  python3 manual-test-seed.py                 # seed  ~/cucumber-jump-manual-test
  python3 manual-test-seed.py /path/to/ws     # seed a custom workspace dir
  python3 manual-test-seed.py --clean         # remove the workspace
  python3 manual-test-seed.py --no-config      # seed WITHOUT cucumberJump.projects (zero-setup testing)

Then open the folder in VS Code/Cursor with the extension installed
(cursor --install-extension cucumber-jump-ext-2.1.0.vsix) or point the
Extension Development Host at it, and walk TESTPLAN.md top to bottom.
"""
import json
import os
import shutil
import sys

argv = sys.argv[1:]
CLEAN = "--clean" in argv
NO_CONFIG = "--no-config" in argv
pos = [a for a in argv if not a.startswith("--")]
WS = os.path.abspath(os.path.expanduser(pos[0])) if pos else os.path.expanduser("~/cucumber-jump-manual-test")

if CLEAN:
    if os.path.exists(WS):
        shutil.rmtree(WS)
        print(f"removed {WS}")
    else:
        print(f"(nothing at {WS})")
    sys.exit(0)

SETTINGS = {
    "cucumberJump.codeLensEnabled": True,
    "cucumberJump.statusBarHintEnabled": True,
    "cucumberJump.projects": [
        {
            "name": "go-legacy",
            "featureGlob": "go-legacy/feature/**/*.feature",
            "bddFile": "go-legacy/testing/bdd.go",
            "stepsGlob": "go-legacy/testing/*_steps.go",
        },
        {"name": "go-new", "featureGlob": "go-new/features/**/*.feature", "stepsGlob": "go-new/steps/**/*.go"},
        {"name": "java", "featureGlob": "java/features/**/*.feature", "stepsGlob": "java/steps/**/*.java"},
        {"name": "kotlin", "featureGlob": "kotlin/features/**/*.feature", "stepsGlob": "kotlin/steps/**/*.kt"},
        {"name": "python", "featureGlob": "python/features/**/*.feature", "stepsGlob": "python/steps/**/*.py"},
        {"name": "ts", "featureGlob": "ts/features/**/*.feature", "stepsGlob": "ts/steps/**/*.steps.ts"},
        {"name": "js", "featureGlob": "js/features/**/*.feature", "stepsGlob": "js/steps/**/*.{js,ts}"},
        {"name": "ruby", "featureGlob": "ruby/features/**/*.feature", "stepsGlob": "ruby/step_definitions/**/*.rb"},
        {"name": "csharp", "featureGlob": "csharp/features/**/*.feature", "stepsGlob": "csharp/Steps/**/*.cs"},
        {"name": "dart", "featureGlob": "dart/features/**/*.feature", "stepsGlob": "dart/steps/**/*.dart"},
        {"name": "broken", "featureGlob": "broken/features/**/*.feature", "stepsGlob": "broken/steps/**"},
    ],
}

FILES = {
    # ── go-legacy: the untouched bddFile StepMap path ─────────────────────────
    "go-legacy/feature/login.feature": '''Feature: Login (legacy Go StepMap)

  Scenario: Admin login
    Given I log in as "admin"
    Then I should see the dashboard
''',
    "go-legacy/testing/bdd.go": '''package testing

var StepMap = map[string]StepHandler{
\t// I log in as "admin"
\t`^I log in as "([^"]*)"$`: func(state *State) error {
\t\treturn loginAs(state, "admin")
\t},
\t// I should see the dashboard
\t`^I should see the dashboard$`: func(state *State) error {
\t\treturn seeDashboard(state)
\t},
}
''',
    "go-legacy/testing/login_steps.go": '''package testing

func loginAs(state *State, user string) error {
\tstate.User = user
\treturn nil
}

func seeDashboard(state *State) error {
\treturn state.AssertPage("dashboard")
}
''',
    # ── go-new: adapter path, ctx.Step — incl. double-quoted \\d escape fix ──
    "go-new/features/cart.feature": '''Feature: Cart (godog ctx.Step)

  Scenario: Manage items
    When I add 3 items to the cart
    And I remove 1 item from the cart
''',
    "go-new/steps/cart_steps.go": r'''package steps

import "context"

func InitializeScenario(ctx *godog.ScenarioContext) {
	ctx.Step(`^I add (\d+) items? to the cart$`, addItems)
	ctx.Step("^I remove (\\d+) items? from the cart$", removeItems)
}

func addItems(ctx context.Context, n int) error {
	return nil
}

func removeItems(ctx context.Context, n int) error {
	return nil
}
''',
    # ── java: regex escapes, escaped quotes, cucumber expr, anchoring ────────
    "java/features/orders.feature": '''Feature: Orders (Java)

  Scenario: Pay for orders
    Given I have 3 orders
    When I pay 25 dollars
    Then I see "OK" on the screen
    And the user logs in
    And the user logs in to admin
''',
    "java/steps/OrderSteps.java": r'''package steps;

public class OrderSteps {

    @Given("I have {int} orders")
    public void iHaveOrders(int n) {
    }

    @When("^I pay (\\d+) dollars$")
    public void iPayDollars(int amount) {
    }

    @Then("I see \"OK\" on the screen")
    public void iSeeOk() {
    }

    @Given("the user logs in")
    public void theUserLogsIn() {
    }
}
''',
    # ── kotlin: shares the Java adapter via .kt mapping ───────────────────────
    "kotlin/features/service.feature": '''Feature: Service (Kotlin)

  Scenario: Health check
    Given the kotlin service is running
''',
    "kotlin/steps/ServiceSteps.kt": '''class ServiceSteps {

    @Given("the kotlin service is running")
    fun serviceIsRunning() {
    }
}
''',
    # ── python: behave decorators, escaped quote ─────────────────────────────
    "python/features/config.feature": """Feature: Config (Python behave)

  Scenario: Strict mode
    Given we have behave installed
    When the config is 'strict'
    Then I see the report
""",
    "python/steps/config_steps.py": r"""from behave import given, when, then


@given('we have behave installed')
def step_installed(context):
    pass


@when('the config is \'strict\'')
def step_strict(context):
    pass


@then("I see the report")
def step_report(context):
    pass
""",
    # ── ts: *.steps.ts double-extension glob, {} parameter, reverse anchor ───
    "ts/features/checkout.feature": '''Feature: Checkout (TypeScript, *.steps.ts glob)

  Scenario: Apply a coupon
    Given I open the checkout page
    And I open the checkout page again
    When I apply coupon SAVE20
    Then I see 2 shiny things in the cart
''',
    "ts/steps/checkout.steps.ts": r'''import { Given, When, Then } from '@cucumber/cucumber';

Given('I open the checkout page', async function () {
});

When(/^I apply coupon ([A-Z0-9]+)$/, async function (code: string) {
});

Then('I see {} in the cart', async function (stuff: string) {
});
''',
    # ── js: brace glob {js,ts} ────────────────────────────────────────────────
    "js/features/profile.feature": '''Feature: Profile (JavaScript, brace glob)

  Scenario: View my profile
    Given I visit the profile page
    Then my name is "Tu Van"
''',
    "js/steps/profile.js": '''const { Given, Then } = require('@cucumber/cucumber');

Given("I visit the profile page", async function () {
});

Then('my name is {string}', async function (name) {
});
''',
    # ── ruby: string + /regex/ forms ──────────────────────────────────────────
    "ruby/features/visit.feature": '''Feature: Visit (Ruby)

  Scenario: Browse
    Given the ruby app is running
    When I visit "home"
''',
    "ruby/step_definitions/visit_steps.rb": '''Given('the ruby app is running') do
end

When(/^I visit "([^"]*)"$/) do |path|
end
''',
    # ── csharp: verbatim @"..." strings (SpecFlow style) ─────────────────────
    "csharp/features/items.feature": '''Feature: Items (C# SpecFlow)

  Scenario: Count items
    Given I have 4 items
    When I say "hello"
    Then checkout is complete
''',
    "csharp/Steps/ItemSteps.cs": r'''namespace Steps;

[Binding]
public class ItemSteps
{
    [Given(@"^I have (\d+) items$")]
    public void GivenIHaveItems(int count)
    {
    }

    [When(@"I say ""hello""")]
    public void WhenISayHello()
    {
    }

    [Then("checkout is complete")]
    public void ThenCheckoutComplete()
    {
    }
}
''',
    # ── dart: flutter_gherkin given1/when1 ───────────────────────────────────
    "dart/features/app.feature": '''Feature: App (Dart flutter_gherkin)

  Scenario: Tap around
    Given the app is launched
    When I tap 5 times
''',
    "dart/steps/app_steps.dart": '''import 'package:flutter_gherkin/flutter_gherkin.dart';

given1('the app is launched', (context) async {
});

when1<int>('I tap {int} times', (count, context) async {
});
''',
    # ── broken: extensionless stepsGlob → loud diagnostic, never silent Go ───
    "broken/features/broken.feature": '''Feature: Broken config (no extension in stepsGlob)

  Scenario: Nothing can resolve
    Given nothing resolves here
''',
    "broken/steps/notes.txt": "This project's stepsGlob (broken/steps/**) has no file extension on purpose.\n",
}

TESTPLAN = """# Cucumber Jump 2.1.0 — manual test plan

Open this folder in VS Code/Cursor with the extension installed
(`cursor --install-extension cucumber-jump-ext-2.1.0.vsix`) or via the
Extension Development Host. CodeLens + status bar hint are pre-enabled in
`.vscode/settings.json`. Work top to bottom; every row should pass.

## Forward navigation (.feature → step definition)

F12 (or the "Implementation" CodeLens) on each step line:

| # | File / step | Expect | Verifies |
|---|---|---|---|
| 1 | go-legacy/login.feature `I log in as "admin"` | lands on `func loginAs(` in login_steps.go | legacy bddFile path unchanged |
| 2 | go-legacy — same line, "Registry" CodeLens | lands on the backtick key in bdd.go | Registry lens works where bddFile exists |
| 3 | go-new/cart.feature `I add 3 items to the cart` | `func addItems(` | adapter Go, backtick pattern |
| 4 | go-new/cart.feature `I remove 1 item from the cart` | `func removeItems(` | **fix: `\\\\d` escapes in double-quoted Go strings** |
| 5 | java/orders.feature `I have 3 orders` | `iHaveOrders` | Cucumber Expression `{int}` |
| 6 | java/orders.feature `I pay 25 dollars` | `iPayDollars` | **fix: `\\\\d` escapes in Java annotations** |
| 7 | java/orders.feature `I see "OK" on the screen` | `iSeeOk` | **fix: escaped quotes `\\"` in annotations** |
| 8 | java/orders.feature `the user logs in` | `theUserLogsIn` | literal match |
| 9 | java/orders.feature `the user logs in to admin` | message "no step definition found" **with a [Show step resolution] button** | anchoring (no substring match) + no-target UX |
| 10 | kotlin/service.feature `the kotlin service is running` | `serviceIsRunning` in .kt | Kotlin via Java adapter |
| 11 | python/config.feature `the config is 'strict'` | `step_strict` | **fix: escaped `\\'` in Python decorators** |
| 12 | ts/checkout.feature `I open the checkout page` | Given in checkout.steps.ts | **fix: `*.steps.ts` double-extension glob** |
| 13 | ts/checkout.feature `I see 2 shiny things in the cart` | the `{}` Then | **fix: anonymous `{}` parameter** |
| 14 | js/profile.feature `I visit the profile page` | profile.js | **fix: `{js,ts}` brace glob** |
| 15 | ruby/visit.feature `I visit "home"` | the `/regex/` block | Ruby regex form |
| 16 | csharp/items.feature `I have 4 items` | `GivenIHaveItems` | **fix: verbatim `@"..."` attributes** |
| 17 | csharp/items.feature `I say "hello"` | `WhenISayHello` | **fix: `\"\"` → `\"` in verbatim strings** |
| 18 | dart/app.feature `I tap 5 times` | `when1<int>` line | Dart adapter |

## Diagnostics

| # | Action | Expect |
|---|---|---|
| 19 | broken/broken.feature, any step → command "Show step resolution" | ⚠ "No file extension detectable in stepsGlob" — NOT a silent Go-adapter attempt |
| 20 | ts/checkout.feature, any step → "Show step resolution" | shows `Language adapter: .ts` and step-file count ≥ 1 |

## Status bar + CodeLens

| # | Action | Expect |
|---|---|---|
| 21 | Cursor on java/orders.feature step lines | status bar shows `steps/OrderSteps.java:<line>` (was "no impl" before the fix) |
| 22 | Any adapter-language feature (java/ts/...) | only the "Implementation" CodeLens — **no dead "Registry" lens** |

## Reverse navigation (step definition → .feature)

| # | Action | Expect |
|---|---|---|
| 23 | checkout.steps.ts, cursor inside `Given('I open the checkout page')` → F12 | ONLY the exact `I open the checkout page` line — **NOT** `...again` (reverse anchoring fix) |
| 24 | OrderSteps.java, cursor in `iPayDollars` → F12 | the `I pay 25 dollars` feature line |

## Dev mode

| # | Action | Expect |
|---|---|---|
| 25 | Open OrderSteps.java (a non-Go step file), run "Toggle Dev mode" with cursor in a step method | session starts: code left, feature right (**was refused before the fix**) |
| 26 | In the paired feature, move the caret across step lines | left pane follows to the matching Java method (**feature→code sync fix**) |
| 27 | In OrderSteps.java, move the caret between methods | right pane follows to the matching feature line |
| 28 | Status bar `DEV ·` quick-pick | says "Focus step file (left)" — no "Go" wording |

## Zero-setup (seed with `python3 manual-test-seed.py --no-config`)

| # | Action | Expect |
|---|---|---|
| 29 | Open java/features/orders.feature, wait ~2s, F12 on `I have 3 orders` | jumps to OrderSteps.java with NO configuration present |
| 30 | Same session | one toast: "Cucumber Jump configured itself — N project(s) detected" with Save / Adjust… / Don't ask again |
| 31 | Toast → "Save to settings" | .vscode/settings.json gains cucumberJump.projects matching the seeded layout (go-legacy is NOT detected — bddFile inference is out of scope) |
| 32 | Command "Create configuration (scan workspace)" (fresh --no-config seed) | quick-pick lists detected projects with `matched X/Y steps` evidence, all pre-checked; confirming writes settings and demonstrates a jump |
| 33 | Command "Rescan workspace for step definitions" | reruns inference and reports the project count |
| 34 | "Show step resolution" on a zero-setup jump | pack line ends with `(inferred — not saved to settings)` |
| 35 | Set `cucumberJump.autoConfigure: false` (fresh --no-config seed) | no inference, no toast; F12 does nothing (as before 2.1.0) |
| 36 | "Welcome: Open Walkthrough…" → Get started with Cucumber Jump | three steps render; Create configuration button works |

Clean up afterwards: `python3 manual-test-seed.py --clean`
"""


def main() -> None:
    os.makedirs(os.path.join(WS, ".vscode"), exist_ok=True)
    settings = dict(SETTINGS)
    if NO_CONFIG:
        settings.pop("cucumberJump.projects", None)
    with open(os.path.join(WS, ".vscode", "settings.json"), "w") as f:
        json.dump(settings, f, indent=2)

    for rel, content in FILES.items():
        path = os.path.join(WS, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)

    with open(os.path.join(WS, "TESTPLAN.md"), "w") as f:
        f.write(TESTPLAN)

    print(f"Seeded {len(FILES) + 2} files into {WS}")
    print(f"  - cucumberJump.projects: {'OMITTED (zero-setup mode)' if NO_CONFIG else '11 projects'}")
    print(f"  - TESTPLAN.md with the 36-point manual checklist")
    print()
    print("Next:")
    print(f"  1. cursor --install-extension cucumber-jump-ext-2.1.0.vsix   (or use the Extension Dev Host)")
    print(f"  2. cursor {WS}")
    print(f"  3. Walk {os.path.join(WS, 'TESTPLAN.md')} top to bottom")


main()
