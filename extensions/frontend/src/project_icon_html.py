"""Remove obsolete positional icon CSS after icons stop rendering DOM nodes."""
import re


def prepare_project_icon_html(html):
    return re.sub(
        r'<link\b(?=[^>]*\bhref=[\"\']/assets/sidebar-project-no-icons-[^\"\']+\.css[\"\'])[^>]*>\s*',
        '', html,
    )


if __name__ == '__main__':
    import sys
    sys.stdout.write(prepare_project_icon_html(sys.stdin.read()))
