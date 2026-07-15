#!/usr/bin/env python3
# Generator for ontology-medical-device-hierarchy.drawio
# Layout invariant: every tab is a vertical stack of labeled bands.
# Parent / foundation / root is the TOP band; children flow downward.
# Bands never overlap (computed geometry); connectors are orthogonal, downward.

import html
import os

PAGE_W, PAGE_H = 1654, 1169
CONTENT_X, CONTENT_W = 50, 1554
TITLE_Y, TITLE_H = 24, 70
BAND_START_Y = 120
BAND_BOTTOM = 1132

# palette: band fill, stroke, node fill
PAL = {
    'base':   ('#f0f0f0', '#999999', '#ffffff'),
    'core':   ('#eef3fc', '#6c8ebf', '#ffffff'),
    'arch':   ('#eef5ff', '#6c8ebf', '#ffffff'),
    'req':    ('#fff4e6', '#d79b00', '#ffffff'),
    'risk':   ('#fbeeee', '#b85450', '#ffffff'),
    'assure': ('#eef7ec', '#82b366', '#ffffff'),
    'view':   ('#f1ebf5', '#9673a6', '#ffffff'),
    'method': ('#fff6da', '#d6b656', '#ffffff'),
    'rules':  ('#e9f8f2', '#0d8b6f', '#ffffff'),
    'note':   ('#f5f5f5', '#666666', '#ffffff'),
}

def esc(s):
    # XML-escape a fully-built HTML string for use inside an attribute value.
    return html.escape(s, quote=True)

def node_value(title, sub=None):
    # Build raw HTML; esc() is applied once at write time (in vertex()).
    v = '<b>' + title + '</b>'
    if sub:
        v += "<br/><font style='font-size:10px'>" + sub.replace('\n', '<br/>') + '</font>'
    return v

class Page:
    def __init__(self, pid, name):
        self.pid = pid
        self.name = name
        self.cells = []
        self._n = 0

    def nid(self, prefix):
        self._n += 1
        return f'{prefix}{self._n}'

    def raw(self, s):
        self.cells.append(s)

    def vertex(self, cid, x, y, w, h, value, style, parent='1'):
        self.cells.append(
            f'<mxCell id="{cid}" value="{esc(value)}" style="{style}" vertex="1" parent="{parent}">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')

    def edge(self, cid, src, tgt, value, style):
        self.cells.append(
            f'<mxCell id="{cid}" value="{esc(value)}" style="{style}" edge="1" parent="1" source="{src}" target="{tgt}">'
            f'<mxGeometry relative="1" as="geometry"/></mxCell>')

    def xml(self):
        body = '\n        '.join(self.cells)
        return (
            f'  <diagram id="{self.pid}" name="{esc(self.name)}">\n'
            f'    <mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" '
            f'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{PAGE_W}" '
            f'pageHeight="{PAGE_H}" math="0" shadow="0">\n'
            f'      <root>\n'
            f'        <mxCell id="0"/><mxCell id="1" parent="0"/>\n'
            f'        {body}\n'
            f'      </root>\n'
            f'    </mxGraphModel>\n'
            f'  </diagram>\n')


def build_tab(spec):
    p = Page(spec['id'], spec['name'])
    # title (raw HTML; esc() applied in vertex())
    title_val = ("<b>" + spec['num'] + '. ' + spec['title'] + "</b>"
                 "<br/><font style='font-size:13px;color:#4d4d4d'>" + spec['sub'] + "</font>")
    p.vertex('t_' + spec['id'], CONTENT_X, TITLE_Y, CONTENT_W, TITLE_H, title_val,
             'text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=top;fontSize=20;')

    tiers = spec['tiers']
    note = spec.get('note')
    n = len(tiers)
    avail_bottom = BAND_BOTTOM - (96 if note else 0)
    avail_h = avail_bottom - BAND_START_Y
    gap = 40
    band_h = (avail_h - (n - 1) * gap) / n
    if band_h < 90:
        gap = 26
        band_h = (avail_h - (n - 1) * gap) / n
    if band_h > 190:
        band_h = 190
    band_h = int(band_h)
    # center the block vertically
    block_h = n * band_h + (n - 1) * gap
    y = BAND_START_Y + max(0, (avail_h - block_h) // 2)

    band_ids = []
    for i, tier in enumerate(tiers):
        bf, st, nf = PAL[tier['pal']]
        bid = f"b{i}_{spec['id']}"
        band_ids.append(bid)
        band_style = (f'swimlane;startSize=30;html=1;fontStyle=1;align=left;'
                      f'fillColor={bf};strokeColor={st};fontSize=13;fontColor=#1f2933;'
                      f'swimlaneFillColor={bf};spacingLeft=8;')
        p.vertex(bid, CONTENT_X, y, CONTENT_W, band_h, '<b>' + tier['name'] + '</b>', band_style)
        # inner nodes (children, relative geometry)
        nodes = tier['nodes']
        k = len(nodes)
        pad_x, ngap = 18, 22
        nw = (CONTENT_W - 2 * pad_x - (k - 1) * ngap) / k
        nw = int(nw)
        ny, nh = 40, band_h - 40 - 14
        inner_ids = []
        nx = pad_x
        for j, node in enumerate(nodes):
            if isinstance(node, tuple):
                val = node_value(node[0], node[1] if len(node) > 1 else None)
            else:
                val = node_value(node)
            inid = f'{bid}_n{j}'
            inner_ids.append(inid)
            nstyle = (f'rounded=1;whiteSpace=wrap;html=1;fillColor={nf};strokeColor={st};'
                      f'fontSize=12;fontColor=#1f2933;align=center;verticalAlign=middle;spacing=6;')
            p.vertex(inid, int(nx), ny, nw, nh, val, nstyle, parent=bid)
            nx += nw + ngap
        # intra-tier sequence arrows
        if tier.get('sequence'):
            for a, b in zip(inner_ids, inner_ids[1:]):
                eid = p.nid('seq_' + spec['id'] + '_')
                p.edge(eid, a, b, '',
                       f'endArrow=block;html=1;edgeStyle=orthogonalEdgeStyle;rounded=1;'
                       f'exitX=1;exitY=0.5;entryX=0;entryY=0.5;strokeColor={st};fontSize=10;')
        y += band_h + gap

    # connectors between bands (downward)
    for i in range(n - 1):
        conn = tiers[i].get('conn', '')
        eid = f"c{i}_{spec['id']}"
        p.edge(eid, band_ids[i], band_ids[i + 1], conn,
               'endArrow=block;endFill=1;html=1;edgeStyle=orthogonalEdgeStyle;rounded=1;'
               'exitX=0.5;exitY=1;entryX=0.5;entryY=0;strokeColor=#444444;fontSize=11;'
               'fontStyle=1;fontColor=#1f2933;labelBackgroundColor=#ffffff;')

    if note:
        nf2, st2, _ = PAL['note']
        p.vertex('note_' + spec['id'], CONTENT_X, BAND_BOTTOM - 84, CONTENT_W, 74,
                 "<b>Note</b>&nbsp;&nbsp;<font style='font-size:12px'>" + note + '</font>',
                 f'rounded=1;whiteSpace=wrap;html=1;fillColor={nf2};strokeColor={st2};'
                 f'fontSize=12;fontColor=#1f2933;align=left;verticalAlign=middle;spacing=10;')
    return p


# ─────────────────────────────────────────────────────────────────────────────
# Tab specifications — content grounded in the current memo ontology and
# public architecture documentation.
# ─────────────────────────────────────────────────────────────────────────────
TABS = [
    {
        'id': 'memo-purpose', 'name': '01-why-memo', 'num': '01',
        'title': 'Why MEMO Exists',
        'sub': 'Medical-device engineering needs a living, reviewable safety argument — not a stack of documents that drift apart.',
        'tiers': [
            {'name': 'The recurring problem', 'pal': 'risk', 'conn': 'a design change lands  ▼', 'nodes': [
                ('Architecture diagrams', None),
                ('Requirements & risk spreadsheets', None),
                ('Verification evidence & test reports', None),
                ('DHF documents & audit packets', None)]},
            {'name': 'The drift', 'pal': 'risk', 'conn': "MEMO's response  ▼", 'nodes': [
                ('Which evidence is still valid?  Which hazards changed?  Which documents must be regenerated?',
                 'Disconnected artifacts cannot answer change-impact questions.')]},
            {'name': "MEMO's purpose", 'pal': 'assure', 'conn': 'produces  ▼', 'nodes': [
                ('Model the system as code', 'SysML v2 is the single engineering format'),
                ('Connect architecture to assurance', 'needs · hazards · controls · requirements · design · tests · evidence form one graph'),
                ('Generate review-ready views', 'diagrams · compliance surfaces · DHF artifacts are projections of the living model')]},
            {'name': 'Desired outcome', 'pal': 'core', 'nodes': [
                ('Ask the model what is affected, what no longer closes, and what evidence must be refreshed.',
                 'Change becomes a query, not an archaeology project.')]},
        ],
    },
    {
        'id': 'memo-ecosystem', 'name': '02-three-product-parts', 'num': '02',
        'title': 'MEMO Has Three Product Parts',
        'sub': 'Portable domain content, automation, and user experience — each with one responsibility. Foundation on top; everything builds downward.',
        'note': 'Dependency direction: memo  ◄  memo-tools  ◄  memo-architect. Domain truth flows from content into tools; the UI never owns medical semantics.',
        'tiers': [
            {'name': 'Foundation — portable SysML v2 content', 'pal': 'method', 'conn': 'content dependency  ▼', 'nodes': [
                ('memo', 'formerly memo-sysmlv2 · base helpers · ontology · methodology · viewpoints · views · rules · examples · no TypeScript · defines what medical-device modeling means')]},
            {'name': 'Engine — automation', 'pal': 'core', 'conn': 'parsed model + validation  ▼', 'nodes': [
                ('memo-tools', 'the CLI · Langium parser · semantic model builder · KerML evaluator · validation · completeness · import / export · dev server · WebSocket')]},
            {'name': 'Experience — guided UI', 'pal': 'assure', 'conn': 'used by  ▼', 'nodes': [
                ('memo-architect', 'the web app · browser UI · viewpoint filtering · diagrams · dashboards · artifact & compliance surfaces')]},
            {'name': 'Users & project', 'pal': 'note', 'nodes': [
                ('Medical-device team', 'systems · safety · software · reviewers'),
                ('Device project', '.sysml files + memo.config.yaml — pins a methodology, holds concrete instances')]},
        ],
    },
    {
        'id': 'ontology-package-map', 'name': '03-package-composition', 'num': '03',
        'title': 'Inside memo: Package Composition',
        'sub': 'Open the content product top-down: shared language first, then domain meaning, then presentation and checks, then method, then proof.',
        'note': 'medical_device_library.sysml is the public import facade — one entry point that re-exports the packages above.',
        'tiers': [
            {'name': 'base/  +  core/   — shared language', 'pal': 'core', 'conn': 'specialized by  ▼', 'nodes': [
                ('base/', 'KerML stdlib wrapper · dimensions · semantics · methodology & rule base types'),
                ('core/', 'IdentifiedElement → TraceableElement roots · 60 enumerations · ~70 typed SemanticLinks')]},
            {'name': 'architecture/  +  compliance/  +  artifacts/   — domain meaning', 'pal': 'arch', 'conn': 'presented & checked  ▼', 'nodes': [
                ('architecture/  (17 sub-packages)', 'context · operational · system · functions · logical · behavior · software · hardware · physical · risk · cyber · assurance · analysis · constraints · decisions'),
                ('compliance/  +  artifacts/', 'ISO 14971 RMF · controlled artifacts · change management · post-market records')]},
            {'name': 'viewpoints/ + views/  +  rules/   — present & verify', 'pal': 'view', 'conn': 'applied by  ▼', 'nodes': [
                ('viewpoints/  +  views/', 'review intent · selection queries · diagram & document-backed views'),
                ('rules/  (5 packs)', 'closure · coverage · cross-layer · lifecycle · quantitative')]},
            {'name': 'methodology/   — tailor & sequence', 'pal': 'method', 'conn': 'instantiated by  ▼', 'nodes': [
                ('methodology/', 'core (MethodologyLibrary · Archetype) · 7 archetypes · profiles · workflow · gates · patterns · DHF bindings · GPCA variant')]},
            {'name': 'examples/gpca-pump/   — proof', 'pal': 'assure', 'nodes': [
                ('examples/gpca-pump/', 'reference project instances: requirements · architecture · behavior · risk · verification · trace · document views')]},
        ],
    },
    {
        'id': 'ontology-metamodel', 'name': '03b-high-level-metamodel', 'num': '03b',
        'title': 'High-Level Metamodel — Packages, Methods, and Examples',
        'sub': 'A more useful mental model for memo-sysmlv2: ontology packages define reusable meaning; methodology selects what a project uses.',
        'note': 'Grounded in memo: base/methodology.sysml defines MethodologyScope include/exclude fields; methodology/memo includes all supported layers, standards, artifacts, and viewpoint types; methodology/gpca derives from it and subtracts cybersecurity + SOUP.',
        'tiers': [
            {'name': 'Layer 0 — language helpers', 'pal': 'base', 'conn': 'gives typing and traceability to  ▼', 'nodes': [
                ('base/', 'portable helper definitions · dimensions · semantics · methodology scope helpers · rule base helpers'),
                ('core/', 'common roots · TraceableElement · enumerations · SemanticLink and typed relationship vocabulary')]},
            {'name': 'Layer 1 — reusable medical-device ontology', 'pal': 'arch', 'conn': 'is projected and constrained by  ▼', 'nodes': [
                ('architecture/', 'the Arcadia-inspired modeling backbone: context · operational · requirements · functions · logical · software · hardware · physical · behavior · risk · assurance'),
                ('architecture add-ons', 'cybersecurity · SOUP · analysis · constraints · decisions sit beside the backbone and can be selected or excluded'),
                ('compliance/ + artifacts/', 'elements that model standards, controlled records, RMF/DHF content, change, and post-market evidence')]},
            {'name': 'Layer 2 — default presentation and standards views', 'pal': 'view', 'conn': 'selected by  ▼', 'nodes': [
                ('viewpoints/', 'default ISO 42010-style viewpoints and selection intent: risk, software architecture, cybersecurity, operational / clinical'),
                ('views/', 'diagram and document-backed projections of the architecture and compliance graph'),
                ('rules/', 'closure, coverage, cross-layer, lifecycle, and quantitative checks over the selected graph')]},
            {'name': 'Methodology — the project recipe', 'pal': 'method', 'conn': 'is derived / resolved into  ▼', 'nodes': [
                ('What it is technically', 'SysML methodology definitions, scopes, profiles, workflows, gates, patterns, rules, and DHF bindings'),
                ('What it chooses', 'which architecture layers to model · which viewpoints / views to use · which standards and artifacts to comply with'),
                ('How teams tailor', 'default includes all supported scope; derived methods pick a subset with included* fields and excludedKind')]},
            {'name': 'Example / project — proves the tailoring', 'pal': 'assure', 'nodes': [
                ('GPCA lightweight methodology', 'extends MedicalDeviceLightDefault · keeps core device layers · excludes cybersecurity concepts and SOUPComponent for a non-networked prototype'),
                ('GPCA project model', 'defines concrete pump instances against that resolved method: requirements · architecture · behavior · risk · verification · trace · document views')]},
        ],
    },
    {
        'id': 'extension-model', 'name': '04-apply-and-extend', 'num': '04',
        'title': 'Apply First. Extend Only When Needed.',
        'sub': 'Most projects select a methodology and instantiate the canonical ontology. New domain packages are an explicit, optional variation point.',
        'note': 'Decision rule: methodology authors select & sequence; project authors instantiate; extension authors specialize only when the shared vocabulary truly lacks a reusable concept.',
        'tiers': [
            {'name': 'Canonical ontology — versioned & stable', 'pal': 'core', 'conn': 'two ways to consume  ▼', 'nodes': [
                ('@memo/ontology', 'shared medical-device concepts · architecture · compliance · artifacts · viewpoints · typed relationships · invariant rules')]},
            {'name': 'Consume', 'pal': 'method', 'conn': 'pinned by  ▼', 'nodes': [
                ('Tailor with methodology', 'choose layers & standards · hide unused kinds / docs · adjust workflow, viewpoints, aliases, rule strength   —   use when the vocabulary already exists'),
                ('Add an extension package', '@memo/ext-* · namespace memo::ontology::ext::<id>::* · specialize canonical kinds + focused rules / views   —   use when a real domain concept is missing')]},
            {'name': 'Extension examples', 'pal': 'assure', 'conn': 'instantiated by  ▼', 'nodes': [
                ('IVD extension', 'memo::ontology::ext::ivd::*'),
                ('Surgical-robotics extension', 'memo::ontology::ext::surgical_robotics::*')]},
            {'name': 'Project model', 'pal': 'assure', 'nodes': [
                ('Project model', 'pins ontology, methodology, and optional extension versions · holds usages & project exemptions, not shared type definitions')]},
        ],
    },
    {
        'id': 'memo-guided-hierarchy', 'name': '05-conceptual-stack', 'num': '05',
        'title': 'Conceptual Stack: From Shared Language to Device Evidence',
        'sub': 'Foundation at top. Each layer specializes the one above; a project at the bottom instantiates the whole stack.',
        'note': 'Semantic links (Satisfies · AllocatesFunction · Mitigates · Verifies · ProducesEvidence · IncludesInDocument) weave the layers; rule packs continuously ask whether the safety argument closes.',
        'tiers': [
            {'name': 'L0 — SysML v2 / KerML helpers', 'pal': 'base', 'conn': 'specialize & reuse  ▼', 'nodes': [
                ('Identity', 'IdentifiedElement\nid · name · description'),
                ('Traceability', 'TraceableElement\nrationale · sourceReference'),
                ('Typed roots', 'ArchitectureElement · VerifiableElement\nInterfaceElement · EvidenceElement · ExchangeItem'),
                ('Portable constraints', 'native constraint def\n+ require bodies')]},
            {'name': 'L1 — Canonical medical-device ontology', 'pal': 'core', 'conn': 'select & tailor  ▼', 'sequence': True, 'nodes': [
                ('1 Clinical intent', 'context · IntendedUse · Actor · UseError'),
                ('2 Operation', 'operational + system · Capability · Scenario'),
                ('3 Obligations', 'requirements · StakeholderNeed · Sys/SW/HW Req'),
                ('4 Design', 'functions + structure · LogicalFunction · SW/HW/Physical'),
                ('5 Risk', 'risk + cyber · Hazard · Harm · Risk · Control · Threat'),
                ('6 Evidence', 'assurance + compliance · VerificationCase · Evidence · RMF')]},
            {'name': 'L2 — Methodology tailoring', 'pal': 'method', 'conn': 'instantiate & govern  ▼', 'nodes': [
                ('Select scope', 'layers · standards · kinds · viewpoints'),
                ('Sequence work', 'WorkflowStep'),
                ('Apply rigor', 'ModelingPattern · QualityGate · usage rules'),
                ('Bind deliverables', 'DHF bindings · RMP · SAD · V&V plan')]},
            {'name': 'L3 — Project model', 'pal': 'assure', 'nodes': [
                ('Device intent', 'IntendedUse · Actor · StakeholderNeed'),
                ('Device architecture', 'Requirements · Functions · SW · HW · Interfaces'),
                ('Safety argument', 'Hazard chain · Controls · VerificationCase · Evidence'),
                ('Controlled outputs', 'RMF · DHF views · Change · Post-market')]},
        ],
    },
    {
        'id': 'core-foundations', 'name': '06-core-specialization-spine', 'num': '06',
        'title': 'Core Foundations — The Specialization Spine',
        'sub': 'Every MEMO element descends from one root. Role types fix which side of a relationship an element may take.',
        'note': 'The Level-2 role types are the extension points: a user definition that specializes a role type automatically participates in the matching SemanticLink ends and the rules that read them.',
        'tiers': [
            {'name': 'Level 0 — Root identity', 'pal': 'base', 'conn': 'specializes  ▼', 'nodes': [
                ('IdentifiedElement', 'id · name · description')]},
            {'name': 'Level 1 — Traceability', 'pal': 'base', 'conn': 'specializes  ▼', 'nodes': [
                ('TraceableElement', 'adds rationale · sourceReference — provenance on every element')]},
            {'name': 'Level 2 — Role types (extension points)', 'pal': 'core', 'conn': 'specializes  ▼', 'nodes': [
                ('RequirementDriver', None), ('VerifiableElement', None),
                ('ArchitectureElement', None), ('InterfaceElement', None),
                ('EvidenceElement', None)]},
            {'name': 'Level 3 — Domain definitions (examples)', 'pal': 'arch', 'nodes': [
                ('Requirement', 'RequirementDriver'),
                ('SoftwareComponent', 'ArchitectureElement'),
                ('ComponentPort', 'InterfaceElement'),
                ('VerificationCase', 'VerifiableElement'),
                ('Evidence / TestResult', 'EvidenceElement')]},
        ],
    },
    {
        'id': 'architecture-map', 'name': '07-architecture-layers', 'num': '07',
        'title': 'Architecture Layers — Problem Space to Solution Space',
        'sub': 'architecture/ is layered from clinical context down to physical realization, with cross-cutting safety, security, and assurance views.',
        'note': 'Each item is a sub-package of architecture/ (17 total). Lower layers realize upper layers; cross-cutting layers reference all of them through typed SemanticLinks.',
        'tiers': [
            {'name': 'Problem space — why & what', 'pal': 'arch', 'conn': 'drives  ▼', 'nodes': [
                ('context', 'IntendedUse · Actor · UseContext · UseError'),
                ('operational', 'OperationalActivity · Capability'),
                ('system', 'SystemContext · Scenario'),
                ('requirements', 'StakeholderNeed · Sys/SW/HW Requirement')]},
            {'name': 'Solution space — functional & logical', 'pal': 'arch', 'conn': 'realized by  ▼', 'nodes': [
                ('functions', 'LogicalFunction · FunctionalChain · Flow'),
                ('behavior', 'ModeState · Transition · Interaction · Timing'),
                ('logical_structure', 'LogicalComponent'),
                ('logical_interfaces', 'Port · Connector · ExchangeItem')]},
            {'name': 'Realization — software, hardware, physical', 'pal': 'arch', 'conn': 'assessed by  ▼', 'nodes': [
                ('software_structure', 'SoftwareSystem · SoftwareComponent · SOUP'),
                ('hardware_structure', 'HardwareAssembly · HardwarePart'),
                ('physical_interfaces', 'PhysicalPort · Connection'),
                ('physical', 'PhysicalComponent · Deployment')]},
            {'name': 'Cross-cutting — safety, security, assurance', 'pal': 'risk', 'nodes': [
                ('risk', 'Hazard · Harm · Risk · Control'),
                ('cybersecurity', 'Asset · Threat · Vulnerability · Mitigation'),
                ('analysis', 'FMEA · FTA · HAZOP'),
                ('assurance · constraints · decisions', 'VerificationCase · Evidence · Constraint · DesignDecision')]},
        ],
    },
    {
        'id': 'context-requirements', 'name': '08-context-and-requirements', 'num': '08',
        'title': 'Context & Requirements — The Obligation Chain',
        'sub': 'From intended use and stakeholder needs down to typed, verifiable requirements and their downstream hooks.',
        'note': 'Links: DerivedFromSource (need → requirement) · Satisfies (design → requirement) · Verifies (case → requirement).',
        'tiers': [
            {'name': 'Clinical context', 'pal': 'arch', 'conn': 'motivates  ▼', 'nodes': [
                ('IntendedUse', None), ('Actor', 'clinician · patient · service'),
                ('UseContext / UseEnvironment', None), ('UseError', None)]},
            {'name': 'Stakeholder needs', 'pal': 'req', 'conn': 'decomposes into  ▼', 'nodes': [
                ('StakeholderNeed', 'what users and standards require of the device')]},
            {'name': 'Requirements (typed)', 'pal': 'req', 'conn': 'satisfied & verified by  ▼', 'nodes': [
                ('SystemRequirement', None), ('SoftwareRequirement', None),
                ('HardwareRequirement', None), ('InterfaceRequirement', None)]},
            {'name': 'Downstream hooks', 'pal': 'assure', 'nodes': [
                ('Function / Component', 'Satisfies'),
                ('VerificationCase', 'Verifies'),
                ('Hazard / RiskControl', 'drives derived safety requirements')]},
        ],
    },
    {
        'id': 'functions-behavior', 'name': '09-functions-and-behavior', 'num': '09',
        'title': 'Functions & Behavior — What the Device Does',
        'sub': 'Logical functions and formal behavior connect requirements to design and to timing / contract guarantees.',
        'note': 'Review §4.2.2: several behavior references (Transition.sourceState, InteractionMessage.senderComponent) are String-typed today; typed model references would strengthen them.',
        'tiers': [
            {'name': 'Functional intent', 'pal': 'arch', 'conn': 'sequenced as  ▼', 'nodes': [
                ('LogicalFunction', None), ('FunctionalChain', None),
                ('FunctionalChainStep', 'allocatedFunction'), ('Flow / ExchangeItem', None)]},
            {'name': 'Behavioral model', 'pal': 'arch', 'conn': 'constrained by  ▼', 'nodes': [
                ('ModeState', None), ('Transition', 'source / target state'),
                ('Interaction / InteractionMessage', None), ('TimingConstraint', None)]},
            {'name': 'Contracts & analysis', 'pal': 'risk', 'conn': 'allocated to  ▼', 'nodes': [
                ('AssumeGuaranteeContract', None), ('BehaviorProperty', None),
                ('Action / ActionKind', None), ('FMEA / FTA hooks', None)]},
            {'name': 'Allocation', 'pal': 'assure', 'nodes': [
                ('AllocatesFunction', 'LogicalFunction → SoftwareComponent / HardwareAssembly — function realized by structure')]},
        ],
    },
    {
        'id': 'design-realization', 'name': '10-design-and-realization', 'num': '10',
        'title': 'Design & Realization — Structure That Carries the Functions',
        'sub': 'Logical components resolve into software, hardware, and physical structure with explicit interfaces and deployment.',
        'note': 'IEC 62304 entities live here: SoftwareSystem · SoftwareComponent · SoftwareUnit · SOUPComponent · SBOMEntry, each carrying a safety class.',
        'tiers': [
            {'name': 'Logical structure', 'pal': 'arch', 'conn': 'realized as software  ▼', 'nodes': [
                ('LogicalComponent', None), ('LogicalInterface', None),
                ('Port / Connector', None), ('ExchangeItem', 'Data / Control definition')]},
            {'name': 'Software', 'pal': 'arch', 'conn': 'and as hardware  ▼', 'nodes': [
                ('SoftwareSystem', None), ('SoftwareComponent', None),
                ('SoftwareUnit', None), ('SOUPComponent / SBOMEntry', None)]},
            {'name': 'Hardware & physical', 'pal': 'arch', 'conn': 'tied together by  ▼', 'nodes': [
                ('HardwareAssembly', None), ('HardwarePart', None),
                ('PhysicalComponent', None), ('PhysicalPort / Connection · Deployment', None)]},
            {'name': 'Realization links', 'pal': 'assure', 'nodes': [
                ('RealizesInterface  ·  AllocatesFunction  ·  Deploys', 'Deployment binds software to hardware; interfaces realize logical contracts')]},
        ],
    },
    {
        'id': 'risk-cyber', 'name': '11-risk-and-cybersecurity', 'num': '11',
        'title': 'Risk & Cybersecurity — The Two Assurance Chains',
        'sub': 'ISO 14971 risk and FDA cybersecurity share one shape: source → effect → control → residual, tied back to safety.',
        'note': 'Verb-named links close both chains: Mitigates · MitigatesVulnerability · TracesToSafety. RiskMatrix and overall evaluation summarize residual risk.',
        'tiers': [
            {'name': 'ISO 14971 risk chain', 'pal': 'risk', 'conn': 'parallels  ▼', 'sequence': True, 'nodes': [
                ('Hazard', None), ('SequenceOfEvents', None), ('HazardousSituation', None),
                ('Harm', None), ('Risk → RiskControl → Residual', None)]},
            {'name': 'Cybersecurity chain (STRIDE / FDA)', 'pal': 'risk', 'conn': 'analyzed by  ▼', 'sequence': True, 'nodes': [
                ('Asset', None), ('Threat', None), ('Vulnerability', None),
                ('ThreatScenario', None), ('CyberRisk → Mitigation → SecurityRequirement', None)]},
            {'name': 'Analysis methods', 'pal': 'arch', 'conn': 'traced to safety  ▼', 'nodes': [
                ('FMEA', 'FailureMode · Effect'), ('FTA', 'FaultTree · Gate'),
                ('HAZOP', 'GuideWord · Deviation')]},
            {'name': 'Safety / security trace', 'pal': 'assure', 'nodes': [
                ('TracesToSafety', 'links cyber risks back to hazards so security and safety arguments stay consistent')]},
        ],
    },
    {
        'id': 'assurance-closure', 'name': '12-assurance-and-closure', 'num': '12',
        'title': 'Assurance & Closure — Proving the Argument',
        'sub': 'Verification produces evidence; evidence closes requirements, controls, and software classes; compliance records persist the result.',
        'note': 'Review §4.2.4: closure & quantitative packs have executable constraint bodies; many coverage / lifecycle rules are still metadata-only placeholders.',
        'tiers': [
            {'name': 'Verification', 'pal': 'assure', 'conn': 'produces  ▼', 'nodes': [
                ('VerificationCase', None),
                ('VerificationMethod', 'test · analysis · inspection · demonstration'),
                ('ValidationActivity', None)]},
            {'name': 'Evidence', 'pal': 'assure', 'conn': 'checked by  ▼', 'nodes': [
                ('Evidence / TestResult', None), ('ProducesEvidence', 'link'),
                ('ArtifactKind', None)]},
            {'name': 'Closure rules', 'pal': 'rules', 'conn': 'persisted as  ▼', 'nodes': [
                ('each Hazard → control', 'Mitigates'),
                ('each Control → verified', 'Verifies'),
                ('Class C SoftwareComponent', 'safety class + verification'),
                ('coverage exists', 'for each selected standard')]},
            {'name': 'Controlled records', 'pal': 'req', 'nodes': [
                ('RiskManagementFile  ·  DHF document views  ·  ChangeRecord  ·  PostMarketRecord',
                 'the durable, regenerable outputs of the model')]},
        ],
    },
    {
        'id': 'links-rules', 'name': '13-semantic-links-and-rules', 'num': '13',
        'title': 'Semantic Links & Rules — How the Graph Stays Honest',
        'sub': 'All ~70 relationships specialize SemanticLink; rule packs read those links to check closure and coverage.',
        'note': 'Naming is migrating from noun + Link (RequirementSatisfactionLink) to verb phrases (Satisfies) — see ontology review §4.2.10.',
        'tiers': [
            {'name': 'Root relationship type', 'pal': 'core', 'conn': 'specialized into families  ▼', 'nodes': [
                ('SemanticLink', 'specializes TraceableElement · linkStatus: planned · active · verified · obsolete · typed end-point parts')]},
            {'name': 'Link families (verb-named)', 'pal': 'view', 'conn': 'read by  ▼', 'nodes': [
                ('Requirements', 'DerivedFromSource · Satisfies · Verifies'),
                ('Risk', 'ContributesToHazard · Mitigates · TracesToRisk'),
                ('Cyber', 'ThreatenedBy · ExploitsVulnerability · MitigatesVulnerability · TracesToSafety'),
                ('Architecture', 'AllocatesFunction · RealizesInterface · Deploys'),
                ('Evidence', 'ProducesEvidence · IncludesInDocument')]},
            {'name': 'Rule packs', 'pal': 'rules', 'conn': 'summarized as  ▼', 'nodes': [
                ('closure', '~15 native constraints'), ('coverage', '~25 metadata'),
                ('cross-layer', '3'), ('lifecycle', '3'), ('quantitative', '2 native')]},
            {'name': 'Verdict surface', 'pal': 'note', 'nodes': [
                ('Rules navigate links', 'mitigates->size() · satisfiedBy->size() · traceTo->size()  →  completeness % and open findings')]},
        ],
    },
    {
        'id': 'viewpoints-documents', 'name': '14-viewpoints-and-documents', 'num': '14',
        'title': 'Viewpoints & Documents — Projecting the Model for Review',
        'sub': 'ISO/IEC/IEEE 42010 viewpoints select model subsets; views render them as diagrams or document-backed artifacts.',
        'note': 'All four default viewpoints are declared userExtensible = true, so teams can add elements and relationships beyond the defaults.',
        'tiers': [
            {'name': 'Viewpoint core (42010)', 'pal': 'view', 'conn': 'instantiated as  ▼', 'nodes': [
                ('Viewpoint', 'userExtensible · ViewSelectionQuery · concerns · stakeholders')]},
            {'name': 'Default viewpoints', 'pal': 'view', 'conn': 'rendered by  ▼', 'nodes': [
                ('Risk Management', None), ('Software Architecture', None),
                ('Cybersecurity', None), ('Operational / Clinical', None)]},
            {'name': 'View core', 'pal': 'view', 'conn': 'bound to  ▼', 'nodes': [
                ('View', None), ('DiagramView', None),
                ('DocumentBackedView', None), ('ViewOutputKind / PresentationKind', None)]},
            {'name': 'DHF artifacts', 'pal': 'req', 'nodes': [
                ('Risk Management File  ·  Software Architecture Document  ·  V&V Plan  ·  Threat Model',
                 'query-driven inclusion keeps every document a projection of the live model')]},
        ],
    },
    {
        'id': 'methodology-workflow', 'name': '15-methodology', 'num': '15',
        'title': 'Methodology — Pick, Sequence, and Gate the Work',
        'sub': 'A methodology selects an ontology subset (additive includes + explicit excludes), sequences the work, and gates quality. Archetypes are presets.',
        'note': 'Three pick-and-choose levels (review §3): 1 Archetype preset · 2 Scope subtraction · 3 Regulatory rule packs.',
        'tiers': [
            {'name': 'Methodology core', 'pal': 'method', 'conn': 'offers presets  ▼', 'nodes': [
                ('MethodologyLibrary · Archetype · MethodologyScope · ResolvedMethodology',
                 'the tailoring vocabulary, all expressed in SysML v2')]},
            {'name': '7 Archetypes (presets)', 'pal': 'method', 'conn': 'refined by  ▼', 'nodes': [
                ('Blank', 'no layers'), ('Minimal', 'context · req · risk / ISO 14971'),
                ('Standard', '+ functions · logical · SW · assurance'),
                ('Full', '14 layers / 9 standards'),
                ('SaMD · Connected · Monitoring · Infusion Pump', 'specialized presets')]},
            {'name': 'Scope tailoring', 'pal': 'method', 'conn': 'pinned by  ▼', 'sequence': True, 'nodes': [
                ('includedArchLayer / includedStandard', None),
                ('excludedKind', 'e.g. CybersecurityAsset · SOUPComponent'),
                ('WorkflowStep sequence', None),
                ('QualityGate / usage rules', None)]},
            {'name': 'Project binding', 'pal': 'assure', 'nodes': [
                ('ProjectMethodBinding', 'pins @memo/methodology-* · the GPCA variant subtracts cybersecurity + SOUP for a non-networked prototype')]},
        ],
    },
    {
        'id': 'gpca-risk-thread', 'name': '16-gpca-worked-thread', 'num': '16',
        'title': 'Worked Thread — One Overdose Risk Through the GPCA Pump',
        'sub': 'Follow a single safety thread top to bottom: intent → requirement → design → hazard → control → verification → evidence → document.',
        'note': 'Every step is a real element kind from L1, woven by the verb-named links in tab 13. This is the chain the rule packs check for closure.',
        'tiers': [
            {'name': 'Intent', 'pal': 'arch', 'conn': 'states  ▼', 'nodes': [
                ('IntendedUse', 'deliver a programmed dose of IV medication to a patient')]},
            {'name': 'Requirement', 'pal': 'req', 'conn': 'is realized by  ▼', 'nodes': [
                ('SoftwareRequirement', 'limit delivered dose to the programmed rate within tolerance')]},
            {'name': 'Design', 'pal': 'arch', 'conn': 'is threatened by  ▼', 'nodes': [
                ('SoftwareComponent: DoseRateController', 'AllocatesFunction: regulate flow rate')]},
            {'name': 'Hazard', 'pal': 'risk', 'conn': 'is mitigated by  ▼', 'nodes': [
                ('Hazard: overdose', 'HazardousSituation: free-flow → Harm: patient injury')]},
            {'name': 'Control', 'pal': 'risk', 'conn': 'is verified by  ▼', 'nodes': [
                ('RiskControl', 'hardware occluder + software rate guard   (Mitigates)')]},
            {'name': 'Verification', 'pal': 'assure', 'conn': 'produces  ▼', 'nodes': [
                ('VerificationCase: rate-limit test', 'Verifies the requirement and the control')]},
            {'name': 'Evidence', 'pal': 'assure', 'conn': 'is included in  ▼', 'nodes': [
                ('Evidence: TestResult = PASS', 'ProducesEvidence')]},
            {'name': 'Document', 'pal': 'view', 'nodes': [
                ('DocumentBackedView: Risk Management File row', 'IncludesInDocument — regenerated whenever the thread changes')]},
        ],
    },
]


def main():
    pages = ''.join(build_tab(t).xml() for t in TABS)
    doc = '<mxfile host="app.diagrams.net" version="24.0.0">\n' + pages + '</mxfile>\n'
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.normpath(os.path.join(
        here, '..', '..', 'docs', 'src', 'diagrams',
        'ontology-medical-device-hierarchy.drawio'))
    with open(out, 'w') as f:
        f.write(doc)
    print(f'wrote {out} with {len(TABS)} tabs')


if __name__ == '__main__':
    main()
