# First Useful Workflow

This workflow turns one engineering concern into a visible, testable trace.

## 1. Add a need and requirement

In a project `.sysml` file:

```sysml
package my_device {
    private import memo_medical_device_library::*;

    requirement safeOperation : StakeholderNeed {
        attribute :>> id = "NEED-001";
        attribute :>> name = "SafeOperation";
        attribute :>> statement = "The device must protect the patient during normal use.";
    }

    requirement detectFault : SystemRequirement {
        attribute :>> id = "REQ-001";
        attribute :>> name = "DetectDeliveryFault";
        attribute :>> statement =
            "The device shall detect a delivery fault within two seconds.";
    }

    connection : DerivesFrom
        connect sourceDriver ::> safeOperation
        to targetRequirement ::> detectFault;
}
```

## 2. Validate the project

```bash
npx memo validate .
```

Read each result as an engineering question. Do not add a meaningless link just
to improve the completeness score.

## 3. Export a reviewable graph

```bash
npx memo export json --output model.json
npx memo export dot --output model.dot
```

The JSON export supports downstream analysis; DOT supports graph visualization.

## 4. Make validation repeatable

```bash
npx memo validate . \
  --format junit \
  --output validation.xml
```

Publish `validation.xml` as a test report in CI. See [Run in CI](../tasks/ci.md)
for GitHub and GitLab examples.

## 5. Extend vertically

Add the responsible function and component, relevant hazard and control, then
the verification case and evidence. The
[MEMO Ontology guide](https://github.com/memoarchitect/memo) explains the layer,
element, and relationship choices.
